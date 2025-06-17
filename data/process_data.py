import requests
import time
from urllib.parse import quote_plus
import pandas as pd
import numpy as np
import copy
from openai import OpenAI
import sys
from tqdm.notebook import tqdm
from sentence_transformers import SentenceTransformer, util
import torch
import json
import os

DEBUG=False

def query(url, params, max_pages=10):
    results = []
    page=1
    count = 0 
    while True:

        print(f"  Fetching page {page}")

        response = requests.get(url, params=params)
        if response.status_code != 200:
            print(f"Error: Received status code {response.status_code}")
            return None
        
        data = response.json()
        total = data['meta']["count"]
        results.extend(data['results'])
        count = count + len(data['results'])

        print(f"    Got {count}/{total}")
        
        time.sleep(0.1)

        if 'next_cursor' not in data['meta'] or not data['meta']['next_cursor']:
            break
        
        params['cursor'] = data['meta']['next_cursor']
        page=page+1

        if(page>=max_pages): break
        if(DEBUG): break
        
    return results,total

def get_abstract(abstract_inverted):
    if(abstract_inverted):
        word_position_list=[(word,position) for word in abstract_inverted for position in abstract_inverted[word] ]
        word_position_list.sort(key=lambda x: x[1])
        abstract = " ".join([x[0] for x in word_position_list])
    else:
        abstract=None
    return abstract

def quote(x):
    if(" " in x): 
        return f"\"{x}\""
    else:
        return x

def get_all_papers(keywords_tech, keywords_health, from_scratch = False):

    if os.path.exists("cache/all_papers.json") and from_scratch == False:
        print("Loading cached papers...")
        with open ("cache/all_papers.json","r") as f:
            papers = json.load(f)
            print(  "Loaded papers data from cache")
            return papers
    

    papers={}

    for keyword_tech in keywords_tech:

        for keyword_health in keywords_health:
            
            query_string = f"{quote(keyword_tech)} AND {quote(keyword_health)}"
            keyword_age_tech = f"{quote(keyword_tech)} x {quote(keyword_health)}"

            print(keyword_age_tech)

            params = {
                "search": query_string,
                "filter": f"language:en",
                "per-page": 200,
                "sort": "relevance_score:desc",
                "cursor":"*"
            }
            url="https://api.openalex.org/works"
            results,count = query(url, params)

            print(f"  Got {count}")
            
            if(len(results)>0):
                titles = [f"{x['display_name']}" for x in results]
                for p in range(len(titles)):
                    print(f"  * {titles[p]}")
                    if(p==5): break

            for paper in results:
                id = paper["id"]
                if id not in papers: 
                    paper["abstract"] = get_abstract(paper["abstract_inverted_index"])
                    papers[id] = paper
                    papers[id]["tech_topics"] = []
                    papers[id]["health_topics"] = []
                    papers[id]["agetech_topics"] = []
                
                papers[id]["tech_topics"].append(keyword_tech)
                papers[id]["health_topics"].append(keyword_health)
                papers[id]["agetech_topics"].append(keyword_age_tech)
                
            time.sleep(0.1)
            print("\n")

        print("\n")

    with open ("cache/all_papers.json","w") as f:
        json.dump(papers,f,indent=2)

    return(papers)

def get_all_author_data(all_papers, from_scratch = False):

    if os.path.exists("cache/all_authors.json") and from_scratch == False:
        print("Loading cached author data ...")
        with open ("cache/all_authors.json","r") as f:
            authors = json.load(f)
            print(  "Loaded all authors data from cache")
            return authors

    authors = {}

    for paper_id, paper  in all_papers.items():

        cite_count = paper['cited_by_count']

        paper_authors = [x["author"]["id"] for x in paper['authorships']]

        for author in paper['authorships']:
            id = author['author']['id']
            position = author['author_position']
            if(id not in authors):
                authors[id] = copy.deepcopy(author["author"])
                authors[id]["publication_count"]= {"first": 0, "middle": 0, "last":0, "total":0}
                authors[id]["citation_count"]= {"first": 0, "middle": 0, "last":0, "total":0}
                authors[id]["papers"] = []

                authors[id]["tech_topics"] = {}
                authors[id]["health_topics"] = {}
                authors[id]["agetech_topics"] = {}

                authors[id]["all_coauthors"] = {}

            if(len(paper['authorships'])<10):
                for coid in paper_authors:
                    if( id==coid): continue 
                    if (coid not in authors[id]["all_coauthors"]):
                        authors[id]["all_coauthors"][coid] = 1
                    else:
                        authors[id]["all_coauthors"][coid] +=1
                
            authors[id]["papers"].append(paper_id)

            authors[id]["publication_count"]["total"] +=1
            authors[id]["publication_count"][position]+=1

            authors[id]["citation_count"]["total"] +=cite_count
            authors[id]["citation_count"][position]+=cite_count

            for tech_topic in paper["tech_topics"]:
                if(tech_topic not in authors[id]["tech_topics"]):
                    authors[id]["tech_topics"][tech_topic] = 0
                authors[id]["tech_topics"][tech_topic]+=1
                    
            for health_topic in paper["health_topics"]:
                if(health_topic not in authors[id]["health_topics"]):
                    authors[id]["health_topics"][health_topic] = 0
                authors[id]["health_topics"][health_topic]+=1

            for agetech_topic in paper["agetech_topics"]:
                if(agetech_topic not in authors[id]["agetech_topics"]):
                    authors[id]["agetech_topics"][agetech_topic] = 0
                authors[id]["agetech_topics"][agetech_topic]+=1

    with open ("cache/all_authors.json","w") as f:
        json.dump(authors,f,indent=2)

    return authors

def get_top_authors(authors, topN):

    top_authors = [(x, x["publication_count"]["total"])  for x in authors.values()]
    top_authors.sort(key=lambda x: x[1],reverse=True)
    top_authors = {x[0]["id"]: x[0] for x in top_authors[:topN]}

    return top_authors

def get_openalex_affiliation_info(openalex_id, verbose=False):

    url = f"https://api.openalex.org/people/{openalex_id}?select=last_known_institutions"
    headers = {'Accept': 'application/json'}
    response = requests.get(url, headers=headers)
    if response.status_code != 200:
        print(f"Error: Received status code {response.status_code}")
        return {"org":None}
    
    data = response.json()

    try:
        org = data["last_known_institutions"][0]["display_name"]
    except Exception as e:
        if verbose: print("Org", e)
        org=None        

    try:
        ror = data["last_known_institutions"][0]["ror"]
    except Exception as e:
        if verbose: print("ROR", e)
        ror=None   

    return {"org":org,"ror":ror}

def get_orcid_affiliation_info(orcid_id, verbose=False):
    """
    Given an ORCID ID, fetch the researcher's current institution using the ORCID public API.
    Returns the name of the latest institution found or None if not found.
    """
    url = f"https://pub.orcid.org/v3.0/{orcid_id}/employments"
    headers = {'Accept': 'application/json'}
    response = requests.get(url, headers=headers)
    if response.status_code != 200:
        print(f"Error: Received status code {response.status_code}")
        return {"title":None, "unit":None, "org":None, "url":None}
    
    data = response.json()

    try:
        title = data['affiliation-group'][0]["summaries"][0]["employment-summary"]["role-title"]
    except Exception as e:
        if verbose: print("Title", e)
        title=None

    try:
        unit = data['affiliation-group'][0]["summaries"][0]["employment-summary"]["department-name"]
    except Exception as e:
        if verbose: print("Unit",e)
        unit=None

    try:
        org = data['affiliation-group'][0]["summaries"][0]["employment-summary"]["organization"]["name"]
    except Exception as e:
        if verbose: print("Org", e)
        org=None        

    try:
        url = data['affiliation-group'][0]["summaries"][0]["employment-summary"]['url']["value"]
    except Exception as e:
        if verbose: print("URL", e)
        url=None  

    try:
        ror = data['affiliation-group'][0]["summaries"][0]["employment-summary"]["organization"]['disambiguated-organization']['disambiguated-organization-identifier']
    except Exception as e:
        if verbose: print("Location", e)
        ror=None          

    return {"title":title, "org":org, "unit":unit, "url":url,"ror":ror}

def get_orcid_person_info(orcid_id, verbose=False):
    """
    Given an ORCID ID, fetch the researcher's current institution using the ORCID public API.
    Returns the name of the latest institution found or None if not found.
    """
    url = f"https://pub.orcid.org/v3.0/{orcid_id}/person"
    headers = {'Accept': 'application/json'}
    response = requests.get(url, headers=headers)
    if response.status_code != 200:
        print(f"Error: Received status code {response.status_code}")
        return {"bio":None}
    
    data = response.json()

    try:
        bio = data['biography']
    except Exception as e:
        if verbose: print(e)
        bio=None

    return {"bio":bio}

def most_cited_papers(researcher, papers, N, max_coauthors=10):

    all_papers = [(papers[paper]["id"],papers[paper]['cited_by_count']) for paper in researcher["papers"] if (papers[paper]["abstract"] and len(papers[paper]["authorships"])<max_coauthors+1)]
    all_papers.sort(key=lambda x: x[1],reverse=True)
    N = min(N, len(all_papers))
    papers = [x[0] for x in all_papers[:N]]
    return papers

def most_recent_papers(researcher, papers, N, max_coauthors=10):

    all_papers = [(papers[paper]["id"],pd.to_datetime(papers[paper]['publication_date'])) for paper in researcher["papers"] if (papers[paper]["abstract"] and len(papers[paper]["authorships"])<max_coauthors+1)]
    all_papers.sort(key=lambda x: x[1],reverse=True)
    N = min(N, len(all_papers))
    papers = copy.copy([x[0] for x in all_papers[:N]])
    return papers

def summarize(openai_client, researcher, papers, N):

    name  = researcher["display_name"]
    title = researcher["title"]
    unit  = researcher["unit"]
    org   = researcher["org"]

    most_cited  = most_cited_papers(researcher, papers, N, max_coauthors=10)
    most_recent = most_recent_papers(researcher, papers, N, max_coauthors=10)
    abstracts   = [papers[x]["abstract"] for x in most_cited + most_recent]
    abstracts   = "\n".join(abstracts)

    msg = ("You will be given a set of research paper abstracts from the most " 
            "cited works of a single researcher. You will reply with accurate but "
            "short 3-4 sentence biography-style summary of the researcher's work based on this  "
            "imformation. Do not make judgements on the value or impact of the work. "
            "Leave out details that could be considered controversial. "
            f"The researcher's name is {name}. ")
    
    if(title and unit and org): msg+= f"Mention the researcher's affiliation is {title}, {unit} at {org}. "
    elif(title and org): msg+= f"Menton the researcher is a {title} at {org}. "
    elif(title ): msg+= f"Mention the researcher is a {title}. "

    msg+= "Here are the abstracts:\n\n" + abstracts

    try:
        # Call the ChatGPT API
        response = openai_client.chat.completions.create(
            model="gpt-4.1-mini",  # You can use "gpt-4" if you have access
            messages=[
                {"role": "system", "content": "You are a helpful research assistant."},
                {"role": "user", "content": msg}
            ]
        )
        
        # Extract and return the generated response
        return response, response.choices[0].message.content.strip()
    
    except Exception as e:
        print(f"An error occurred: {str(e)}")
        return(None)

def get_top_papers(authors, papers):

    print("Getting top papers...")

    for researcher in tqdm(authors.values()): 
        researcher["most_cited_papers"]  = most_cited_papers(researcher, papers,5,max_coauthors=np.inf)
        researcher["most_recent_papers"] = most_recent_papers(researcher, papers,5,max_coauthors=np.inf)
    return authors

def get_top_topics(authors, papers, topN=10):

    print("Getting top topics ...")

    for researcher in tqdm(authors.values()): 

        for field in ["tech_topics","health_topics", "agetech_topics"]:

            top_field = "top_" + field
            researcher[top_field] = [[name, count] for [name,count] in researcher[field].items()]
            researcher[top_field].sort(key=lambda x: x[1],reverse=True)
            if(len(researcher[top_field])>topN):
                researcher[top_field] = researcher[top_field][:10]

    return authors

def get_top_coauthors(authors, papers):

    print("Getting top co-authors...")

    for researcher in tqdm(authors.values()): 
        #Get co-authors that are also top researchers
        top_coauthors = [[id,count] for id,count in researcher["all_coauthors"].items() if id in authors]
        top_coauthors.sort(key=lambda x: x[1], reverse=True)
        researcher["top_coauthors"] = top_coauthors
    return authors

def get_affiliation(authors, papers, from_scratch=False, update_cache=True):

    print("Getting author affiliation info...")

    affiliations_cache_update=False

    #Load affiliations cache
    if(os.path.exists("cache/affiliations.json") and from_scratch==False):
        with open("cache/affiliations.json","r") as f:
            affiliations_cache  = json.load(f)
    else:
        affiliations_cache={}  

    #Load ROR cache
    df = pd.read_csv("cache/ror.csv",low_memory=False)
    df = df.set_index("id")
    df = df[["locations.geonames_details.name","locations.geonames_details.country_subdivision_name","locations.geonames_details.country_name","locations.geonames_details.lat","locations.geonames_details.lng",]]
    ror_cache = df.to_dict(orient='index') 

    for researcher in tqdm(authors.values()): 

        openalex_id = researcher["id"]

        if(openalex_id not in affiliations_cache):

            info = info = {"title":None, "org":None, "unit":None, "url":None, "ror": None}

            if(researcher['orcid'] is not None):
                orcid      = researcher['orcid'].split("/")[-1]
                orcid_info = get_orcid_affiliation_info(orcid)
                if(orcid_info is not None): 
                    for field in info:
                        if (field in orcid_info): info[field] = orcid_info[field]
                    
            if(info["org"] is None or info["ror"] is None):
                openalex_info = get_openalex_affiliation_info(researcher["id"])
                if(openalex_info is not None):
                    for field in info:
                        if (field in openalex_info): info[field] = openalex_info[field]
            
            if(info["ror"] in ror_cache):
                ror_data = ror_cache[info["ror"]]
                info["city"] =  ror_data['locations.geonames_details.name']
                info["region"] = ror_data['locations.geonames_details.country_subdivision_name']
                info["country"] = ror_data['locations.geonames_details.country_name']
                info["lat"] = ror_data['locations.geonames_details.lat']
                info["lon"] = ror_data['locations.geonames_details.lng']
            else:
                info["city"] =  None
                info["region"] = None
                info["country"] = None
                info["lat"] = None
                info["lon"] = None

            affiliations_cache_update = True            
            affiliations_cache[openalex_id] = copy.copy(info)

        researcher.update(affiliations_cache[openalex_id])

    if(update_cache):

        if(affiliations_cache_update):
            with open("cache/affiliations.json","w") as f:
                json.dump(affiliations_cache,f, indent=2)

    return(authors)

def get_ai_summary(authors, papers, from_scratch=False, update_cache=True):

    print("Getting AI summaries...")

    openai_client = OpenAI()
    summaries_cache_update = False

    #Load AI summary cache
    if(os.path.exists("cache/ai_summaries.json") and from_scratch==False):
        with open("cache/ai_summaries.json","r") as f:
            summaries_cache  = json.load(f)
    else:
        summaries_cache={}

    for researcher in tqdm(authors.values()): 

        if(researcher["id"] not in summaries_cache):
            response, summary = summarize(openai_client, researcher, papers, 5)
            summaries_cache[researcher["id"]] = summary
            summaries_cache_update = True

        researcher["ai_summary"] = summaries_cache[researcher["id"]]

    if(update_cache):

        if(summaries_cache_update):
            with open("cache/ai_summaries.json","w") as f:
                json.dump(summaries_cache, f, indent=2)

    return(authors)

def save_authors(authors):

    with open("authors.json","w") as f:
        json.dump(authors, f, indent=2)

def save_papers(papers):

    fields = ["id","ids","doi","title","publication_year", 'tech_topics', 'health_topics', 'agetech_topics', 'cited_by_count', 'relevance_score']
    #'topics', 'keywords',

    trimmed_papers = {}

    for id,paper in papers.items():
        paper_new = {x:paper[x] for x in fields}
        paper_new["author_ids"]=[x['author']['id'] for x in paper['authorships']]
        paper_new["authors"]=[x['author']['display_name'] for x in paper['authorships']]
        try:
            paper_new["source"] = paper["primary_location"]["source"]["display_name"]
        except Exception as e:
            paper_new["source"] = ""
            
        trimmed_papers[id]=paper_new

    with open("papers.json","w") as f:
        json.dump(trimmed_papers, f, indent=2)

def main():

    topN = 100

    keywords_tech   = ["artificial intelligence",
                    "machine learning", 
                    "computer vision", 
                    "robotics", 
                    "large language models", 
                    "genai", 
                    "neural networks", 
                    "wearables", 
                    "remote sensing"]

    keywords_health = ["healthy aging", 
                    "dementia",
                    "alzheimers disease",
                    "cognitive impairment",
                    "frailty"]

    papers      = get_all_papers(keywords_tech, keywords_health) 
    authors     = get_all_author_data(papers)
    top_authors = get_top_authors(authors, topN)
    top_authors = augment_researcher_data(top_authors, papers)

    save_authors(authors)
    save_papers(papers)





