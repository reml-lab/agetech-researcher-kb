function do_search(text){
    const searchInput = document.querySelector('.gridjs-input');
    if (searchInput) {
        searchInput.value = text;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function fetchJSON(url1, url2) {
    // Fetch both files
    const fetch1 = fetch(url1).then(response => response.json());
    const fetch2 = fetch(url2).then(response => response.json());

    // Wait for both fetches to complete
    return Promise.all([fetch1, fetch2])
        .then(([data1, data2]) => {
            return {"authors":data1, "papers":data2 };
        })
        .catch(error => {
            console.error("Error fetching or parsing JSON:", error);
            throw error;
        });
}

function get_citation(paper){
    var cite = "";
    var authors = "";

    if(paper["authors"].length>10){
        authors = `${paper["authors"].slice(0,10).join(", ")}, and additional authors. `;
    }
    else{
        authors = `${paper["authors"].join(", ")}. `;
    }

    if("doi" in paper["ids"]){
        cite =  `<A HREF="${paper["ids"]["doi"]}" target="_blank"><IMG width="24" SRC="img/doi.png" title="Open DOI"></A>`;
    }
    else{
        cite =  `<A HREF="${paper["ids"]["OpenAlex"]}" target="_blank"><IMG width="24" SRC="img/openalex.png" title="Open in OpenAlex"></A>`;
    }
    cite+= `${authors}`;
    cite+= `<em>${paper["title"]}</em> `;
    cite+= `${paper["source"]}. `; 
    cite+= `${paper["publication_year"]}. `;
    cite+= `(Cited by ${paper["cited_by_count"]}) `;

    return(cite)
}

function researcher_id_to_link(id, text){
    return `<A href="index.html?researcher=${id.split("/")[3]}">${text}</A>`
}

function get_paper_for_grid(paper, authors_lookup){

    var truncated="";
    var author_ids = null;
    if(paper["authors"].length>10){
        author_ids = paper["author_ids"].slice(0,10);
        author_names =  paper["authors"].slice(0,10);
        truncated= ", and additional authors";
    }
    else{
        author_ids = paper["author_ids"];
        author_names =  paper["authors"];
    }

    var author_strings = author_ids.map((id,index) => {
        if(id in authors_lookup){
            return(researcher_id_to_link(id,authors_lookup[id]["display_name"]));
        }    
        else{
            return(author_names[index]);
        }    
    });

    var tech_topics = paper["tech_topics"].join(","); 
    var health_topics = paper["health_topics"].join(",");

    var authors = author_strings.join(", ") + truncated;

    var cite = `${authors}. <em>${paper["title"]}</em>. ${paper["source"]}. ${paper["publication_year"]}`;
    
    var links = ""
    if("doi" in paper["ids"]){
        links +=  `<A HREF="${paper["ids"]["doi"]}" target="_blank"><IMG width="24" SRC="img/doi.png" title="Open DOI"></A>`;
    }
    if("pmcid" in paper["ids"]){
        links +=  `<A HREF="${paper["ids"]["pmcid"]}" target="_blank"><IMG width="24" SRC="img/pmc.png" title="Open in PubMed Central"></A>`;
    }
    if("pmid" in paper["ids"]){
        links +=  `<A HREF="${paper["ids"]["pmid"]}" target="_blank"><IMG width="24" SRC="img/pubmed.png" title="Open in PubMed"></A>`;
    }

    links +=  `<A HREF="${paper["id"]}" target="_blank"><IMG width="24" SRC="img/openalex.png" title="Open in OpenAlex"></A>`;

    return({"paper":cite, "year":paper["publication_year"], "links":links, "citations":paper["cited_by_count"], tech_topics: tech_topics, health_topics:health_topics})

}

function format_name_count_list(name_count_list,N){
    var html = name_count_list.slice(0,N).map( a=> `<LI>${a[0]} (${a[1]})</LI>` ).join("\n");
    return(html);
}

function format_author_id_count_list(author_ids,authors,N){
    var html = author_ids.slice(0,N).map( ([id, count]) => `<LI><A href="index.html?researcher=${id.split("/")[3]}">${authors_lookup[id]["display_name"]}</A> (${count})</LI>`).join("\n")
    return(html);
}

function get_neighbors(researcher){
    var id = researcher["id"];
    return Object.keys(researcher["embedding_neighbors"]).map(key=> [id, key, researcher["embedding_neighbors"][key]])
}

function get_embedding_similarity_graph(researcher,authors_lookup){
    var edges = Object.keys(researcher["embedding_neighbors"]).map(key=> get_neighbors(authors_lookup[key]));
    edges = edges.flat();

    var nodes = [... new Set([...edges.map(a=>a[0]), ... edges.map(a=>a[1])])]
    //edges = edges.filter(x => x[0]<x[1]);

    return({nodes:nodes, edges:edges})
}

function get_coauthor_graph(id, authors_lookup, max_depth, max_nodes){
    
    var ids = [id]
    var nodes = [[id,authors_lookup[id]["total_citation_count"]]]
    var edges =[]
    var id_queue = [[id,0]]

    var node_count = 0

    while(id_queue.length>0){

        [id, depth] = id_queue.shift()

        //console.log(`Expanding ${id} at depth ${depth} of ${max_depth} on step ${expand_count}`)

        if(depth<max_depth){

            var co_authors = authors_lookup[id]["top_coauthors"];
            for([coid,count] of co_authors){
                if(id<coid){
                    edges.push([id, coid, count]);
                }
                else{
                    edges.push([coid, id, count])
                }
                if(!ids.includes(coid)){
                    //console.log(`   Found coauthor ${coid}`)
                    ids.push(coid);
                    nodes.push([coid,authors_lookup[coid]["total_citation_count"]]);
                    id_queue.push([coid, depth+1])
                    node_count+=1;

                    if(node_count>max_nodes){
                        break
                    }
                }
            }
        }

        if(node_count>max_nodes){
            break
        }
    }

    edges = Array.from(new Set(edges.map(arr => JSON.stringify(arr))), str => JSON.parse(str));

    return({"nodes": nodes,"edges":edges});
}

function render_graph(researcher,authors_lookup){

    var id=researcher["id"];
    var graph = get_coauthor_graph(id,authors_lookup,3,25)
    const vis_nodes = new vis.DataSet(graph.nodes.map(([id1,count]) => ({id:id1, label: authors_lookup[id1]["display_name"], value: count/500, url:`index.html?researcher=${id1.split("/")[3]}`}))); 
    const vis_edges = new vis.DataSet(graph.edges.map(([id1,id2,count]) => ({from:id1, to:id2, springConstant: count, value:count, title: count })));
    
    vis_nodes.update({id:id, color:{background: '#97C2FC',border: '#2B7CE9'},x: 0.0, y: 0.0, fixed: true })

    // Create a network
    const container = document.getElementById("network");
    const data = {
      nodes: vis_nodes,
      edges: vis_edges,
    };

    window.graph_data = data;

    const options = {
        physics:{
            enabled: true,
            stabilization: true,
            solver: 'barnesHut',
            barnesHut: {
                gravitationalConstant: -2000,
                centralGravity: 0.3,
                springLength: 100,
                springConstant: 0.1,
                damping: 0.09,
                avoidOverlap: 0
            }
        },
        edges: {
            color: {
            color: "#848484"
            }
        },
        nodes: {
            font: {
                color: '#343434',
                size: 12
            },
            color: {
                border: '#AAAAAA',
                background: '#DDDDDD'
            },
            shape: 'ellipse',
            scaling: {
                min: 8,
                max: 12,
                label: {
                    enabled: true,
                    min: 8,
                    max: 20,
                    maxVisible: 30,
                    drawThreshold: 5
                },
            }
        },
        layout: {
            randomSeed: 0
        }
    };



    // Initialize the network
    const network = new vis.Network(container, data, options);
    window.network = network;

    network.once('stabilizationIterationsDone', function () {
        network.moveTo({scale: 1, position: { x: 0, y: 0 }, animation: false
        });
    });

    network.on("click", function(params) {
        if (params.nodes.length === 1) {
            // Get the clicked node's id
            const nodeId = params.nodes[0];
            const node = window.graph_data.nodes.get(nodeId);
            const container = document.getElementById("researcher_preview");
            var researcher = window.authors_lookup[nodeId];
            container.innerHTML=get_researcher_preview(researcher,300);
        }
    });

}

function get_researcher_preview(researcher,N){
    id = researcher["id"]
    blurb  = `<p><b>${researcher_id_to_link(id,researcher["display_name"])}. ${researcher["affiliation"]}.</b>
              <em>${researcher["ai_summary"].slice(0,N)} ... </em> 
              ${researcher_id_to_link(id,"<i class='bi bi-box-arrow-right'></i>")}</p>
              `
    return(blurb)
}

async function get_data(){

    const authors_json = "data/authors.json"; 
    const papers_json = "data/papers.json"; 

    return fetchJSON(authors_json, papers_json).then(all_data => {
        var authors_lookup = all_data["authors"];
        var papers_lookup = all_data["papers"];

        for (var row of Object.values(authors_lookup)){
            row["total_paper_count"] = row["publication_count"]["total"];
            row["total_citation_count"] = row["citation_count"]["total"];
            row["affiliation"]="";
            if(row["title"]) row["affiliation"] = row["title"] + ", ";
            if(row["unit"]) row["affiliation"] += row["unit"] + ", ";
            if(row["org"]) row["affiliation"] += row["org"];
            if(row["affiliation"].slice(-2)==", ") row["affiliation"]=row["affiliation"].slice(0, -2);
            row["name_affiliation"] = `${row["display_name"]}. ${row["affiliation"]}.`;

            row["preview"] = get_researcher_preview(row, 300);

            var all_papers = row["papers"].map(a => get_paper_for_grid(papers_lookup[a], authors_lookup));
            row["all_papers"] = all_papers;
        }

        window.authors_lookup=authors_lookup;
        window.papers_lookup=papers_lookup;

        return { authors_lookup, papers_lookup };;

    }).catch(error => {
        console.error("Error loading json data:", error);
    });
}

function make_card(header, body){
    out =  `<div class="card w-100 h-100" >
                <div class="card-header">
                    ${header}
                </div>
                <div class="card-body p-4">
                    ${body}
                </div>
            </div>`
    return(out)
}

function make_card_list(header, card_list){
    out =  `<div class="card w-100 h-100" >
                <div class="card-header">
                    ${header}
                </div>
                <UL class="list-group list-group-flush">
                    ${card_list}
                </UL>
         </div>`
    return(out)
}

function make_paper_grid(papers, div_name){

    //Select Columns 
    var columns= [
            {name: "Paper", field: "paper", formatter: (cell) => gridjs.html(cell)},
            {name: "Year", field: "year", formatter: (cell) => gridjs.html(cell)},
            {name: "Citations", field: "citations", 
                formatter: (cell) => gridjs.html(cell), 
                attributes: (cell) => ({style: 'text-align: right'}),
                sort: { enabled: true, direction: 'desc'}
            },
            {name: "Links", field: "links", formatter: (cell) => gridjs.html(cell)},
            {name: "Tech Topics", field: "tech_topics", hidden:true, formatter: (cell) => gridjs.html(cell)},
            {name: "Health Topics", field: "health_topics", hidden:true, formatter: (cell) => gridjs.html(cell)}

        ]

    papers = papers.sort((a,b) => b["citations"]-a["citations"])



    //Select Data
    var griddata = papers.map(row => columns.map(col => row[col.field]));
        
    // Initialize papers grid
    var papers_grid = new gridjs.Grid({
        columns: columns,
        data: griddata,
        search: {
            ignoreHiddenColumns: false
        },
        sort: true,
        pagination: true,
        search_hidden: true
    })

    //Render papers grid
    papers_grid.render(document.getElementById(div_name));
}

function  show_researcher(researcher,authors_lookup){

    //console.log(researcher);
    //console.log(get_embedding_similarity_graph(researcher,authors_lookup))

    const researcher_div = document.getElementById('main');

    var researcher_name = researcher["display_name"];
    var id =  researcher["id"];
    var orcid = researcher["orcid"]

    var title = `<H4>${researcher_name}, ${researcher["affiliation"]}
                 <a href="${id}" target="_blank"><img src ="img/openalex.png"></a>`
    if(orcid) title += `<a href="${orcid}" target="_blank"><img src ="img/orcid.png"></a>`
    title += "</H4>"

    var top = make_card(title, "<i class='bi bi-openai'></i> " + researcher['ai_summary']);
    var top_tech_topics = make_card("<i class='bi bi-cpu'></i> <B>Top Tech Topics</B>", format_name_count_list(researcher["top_tech_topics"]));
    var top_health_topics = make_card("<i class='bi bi-clipboard2-pulse'></i> <B>Top Aging Topics</B>", format_name_count_list(researcher["top_health_topics"]));
    var top_coauthors = make_card("<i class='bi bi-people'></i> <B>Top AgeTech Co-Authors</B>", format_author_id_count_list(researcher["top_coauthors"],authors_lookup) );
      
    researcher_div.innerHTML = `<div class='row'>
                                    <div class="col-md-12 mt-4">
                                        ${top}
                                    </div>
                                </div>
                                <div class='row'>
                                    <div class="col-md-12 mt-4">
                                        <div class="card w-100" >
                                            <div class="card-header">
                                                <B><i class="bi bi-diagram-3"></i> ${researcher_name}'s Local Co-Author Network</B>
                                            </div>
                                            <div class="card-body p-0">
                                                <div class="row p-0">
                                                    <div class="col-9 p-0" id="network" style="height:400px"></div>
                                                    <div class="col-3 p-4 border-start border-1 overflow-auto" id="researcher_preview" style="height:400px"></div>
                                                </div>
                                            </div>
                                        </div>
                                      
                                    </div>
                                 </div>
                                <div class='row'>
                                    <div class="col-md-4 mt-4">
                                        ${top_tech_topics}
                                    </div>
                                    <div class="col-md-4 mt-4">
                                        ${top_health_topics}
                                    </div>
                                    <div class="col-md-4 mt-4">
                                        ${top_coauthors}
                                    </div>
                                </div>
                                <div class='row'>
                                    <div class="col-md-12 mt-4">
                                        <div class="card w-100" >
                                            <div class="card-header">
                                                <i class="bi bi-file-text"></i> <b>${researcher_name}'s AgeTech Research Papers</b>
                                            </div>
                                            <div id="papers" class="card-body p-4"></div>
                                        </div>                                    
                                    </div>
                                </div>`

    render_graph(researcher, authors_lookup);
    make_paper_grid(researcher["all_papers"], "papers") 
}

function getPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject);
  });
}

async function processLocation() {
        try {
            const position = await getPosition();
            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;
            console.log(`Latitude: ${latitude}, Longitude: ${longitude}`);
            // Do something with the coordinates
        } catch (error) {
            console.error("Error getting location:", error.message);
        }
    }

function show_browser(authors_lookup){

    authors = Object.values(authors_lookup);
    authors = authors.sort((a,b) => b["citation_count"]-a["citation_count"]);

    //Select Columns 
    var columns= [
            {name: "Researcher", field: "preview", formatter: (cell) => gridjs.html(cell)},
            {name: "#Papers", field: "total_paper_count", 
                formatter: (cell) => gridjs.html(cell), 
                attributes: (cell) => ({style: 'text-align: right'}),
                width: '100px'
            },           
            {name: "#Citations",  field: "total_citation_count", 
                formatter: (cell) => gridjs.html(cell), 
                attributes: (cell) => ({style: 'text-align: right'}),
                width: '100px'
            },
            {name: "Summary", field: "ai_summary", hidden: true},
            {name: "City", field: "city", hidden:true},
            {name: "Region", field: "region", hidden:true},
            {name: "Country", field: "country", hidden:true},
            {name: "Lat", field: "lat", hidden:true},
            {name: "Lon", field: "lon", hidden:true},
    ]

    //Select Data
    var griddata = authors.map(row => columns.map(col => row[col.field]));
        
    // Initialize papers grid
    var authors_grid = new gridjs.Grid({
        columns: columns,
        data: griddata,
        search: true,
        sort: true,
        pagination: true,
        resizable: true
    })

    //Render papers grid
    authors_grid.render(document.getElementById("main"));

}


function main(){

    get_data().then(({authors_lookup, papers_lookup}) => {

        //var graph = get_coauthor_graph("https://openalex.org/A5100606557",authors_lookup,2);
        //console.log(graph);
        //return;


        // Get the full URL
        const url = window.location.href;
        const params = new URLSearchParams(window.location.search);

        if(params.has("researcher")){
            var id = `https://openalex.org/${params.get("researcher")}`;
            show_researcher(authors_lookup[id],authors_lookup);
        }
        else{
            show_browser(authors_lookup);
        }
        document.getElementById("loading").style.display = 'none';
    });

    
}

main();

/*fetchJSON(authors_json, papers_json).then(all_data => {
    var authors_data = all_data["authors"];
    var papers_data = all_data["papers"];

    var paper_lookup = Object.fromEntries(papers_data.map(item => [item["id"], item]));
    var authors_lookup = Object.fromEntries(authors_data.map(item => [item["id"], item]));

    for (var row of authors_data){
        row["paper_count"] = row["publication_count"]["total"];
        row["citation_count"] = row["citation_count"]["total"];
        row["affiliation"]="";
        if(row["title"]) row["affiliation"] = row["title"] + ", ";
        if(row["unit"]) row["affiliation"] += row["unit"] + ", ";
        if(row["org"]) row["affiliation"] += row["org"];
        if(row["affiliation"].slice(-2)==", ") row["affiliation"]=row["affiliation"].slice(0, -2);
        row["name_affiliation"] = `${row["display_name"]}. ${row["affiliation"]}.`;

        //Get papers
        var most_cited_papers = row["most_cited_papers"].map(a => `<LI>${ get_citation(paper_lookup[a]) }</LI>`).join("\n");

        //Get similar authors
        var similar_authors =Object.keys(row["embedding_neighbors"]).map( key => `<LI>${authors_lookup[key]["display_name"]} (${(100*row["embedding_neighbors"][key]).toFixed(1)})</LI>`).join("\n")

        //return;

        //Get topics
        var pub_counts = row["publication_count_by_topic"];
        topic_list = []
        for (var t1 in  pub_counts){
            for (var t2 in  pub_counts[t1]){
                topic_list.push([`${t1} x ${t2}`, pub_counts[t1][t2]]);
            }
        }
        topic_list=topic_list.sort((a, b) => b[1] - a[1]);
        top_topics = topic_list.slice(0,5).map( a=> `<LI>${a[0]} (${a[1]})</LI>` ).join("\n");

        var details = `<div style="margin-bottom:1em"> <i class="bi bi-openai"></i> <B>Research Summary:</B> ${row['ai_summary']}</div>`;
        details    += `<div style="margin-bottom:1em"> <i class="bi bi-send-fill"></i> <B>Top AgeTech Topics:</B><UL>\n${top_topics}</UL></div>`;
        details    += `<div style="margin-bottom:1em"> <i class="bi bi-people"></i> <B>Most Similar Researchers:</B><UL>\n${similar_authors}</UL></div>`;
        details    += `<div style="margin-bottom:1em"> <i class="bi bi-file-earmark-text-fill"></i> <B>Most Cited AgeTech Papers:</B><UL>\n${most_cited_papers}</UL></div>`;
        
        var id = row["id"];
        row["researcher"] = row["name_affiliation"]
        row["researcher"] +=`
            <A HREF="#expandableDiv-${id}"  role="button" data-bs-toggle="collapse" aria-expanded="false" aria-controls="expandableDiv-${id}">[More]</A>
            <div class="collapse" id="expandableDiv-${id}">
                <div class="card border-0 bg-transparent">
                    <div class="card-body mt-2">
                    ${details}
                    </div>
                </div>
            </div>`

        row["links"] = `<A HREF="${row["id"]}" target="_blank"><IMG width="24" SRC="img/openalex.png" title="Open in OpenAlex"></A>`;
        if(row["orcid"]){ 
            row["links"] = `<A HREF="${row["orcid"]}" target="_blank"><IMG width="24" SRC="img/orcid.png" title="Open in ORCID"></A>` + row["links"];
        }
    }

    //Select Columns 
    columns= [
            {name: "researcher", formatter: (cell) => gridjs.html(cell)},
            {name: "display_name",hidden: true},
            {name: "affiliation",hidden: true},
            {name: "title", hidden: true},
            {name: "unit", hidden: true},
            {name: "org", hidden: true},
            {name: "paper_count", formatter: (cell) => gridjs.html(cell)},
            {name: "citation_count", formatter: (cell) => gridjs.html(cell)},
            {name: "links", formatter: (cell) => gridjs.html(cell)}
        ]

    //Select Data
    griddata = authors_data.map(row => columns.map(col => row[col.name]));
        
    // Initialize Grid.js
    new gridjs.Grid({
        columns: columns,
        data: griddata,
        search: true,
        sort: true,
        pagination: false
    }).render(document.getElementById("grid"));
    }).catch(error => {
    console.error("Error loading json data:", error);
});*/



// Fetch and parse the CSV
/*fetch(authors_json)
    .then(response => response.text())
    .then(raw_author_data => {


    //Get and parse data
    const data = JSON.parse(raw_author_data);
    var columns = Object.keys(data[0]).filter(k => k !== ""); // Remove empty headers        

    for (var row of data){
        row["paper_count"] = row["publication_count"]["total"];
        row["citation_count"] = row["citation_count"]["total"];
        row["affiliation"]="";
        if(row["title"]) row["affiliation"] = row["title"] + ", ";
        if(row["unit"]) row["affiliation"] += row["unit"] + ", ";
        if(row["org"]) row["affiliation"] += row["org"];
        if(row["affiliation"].slice(-2)==", ") row["affiliation"]=row["affiliation"].slice(0, -2);
        row["name_affiliation"] = `${row["display_name"]}. ${row["affiliation"]}.`;

        //Get topics
        var pub_counts = row["publication_count_by_topic"];
        topic_list = []
        for (var t1 in  pub_counts){
            for (var t2 in  pub_counts[t1]){
                topic_list.push([`${t1} x ${t2}`, pub_counts[t1][t2]]);
            }
        }
        topic_list=topic_list.sort((a, b) => b[1] - a[1]);
        top_topics = topic_list.slice(0,5).map( a=> `<LI>${a[0]} (${a[1]})</LI>` ).join("\n");



        var details = `<LI><B>Research Summary:</B> ${row['ai_summary']}</LI>`;
        details += `<LI><B>Top AgeTech Topics</B><UL>\n${top_topics }</UL></LI>`

        var id = row["id"];
        row["researcher"] = row["name_affiliation"]
        row["researcher"] +=`
            <A HREF="#expandableDiv-${id}"  role="button" data-bs-toggle="collapse" aria-expanded="false" aria-controls="expandableDiv-${id}">[More]</A>
            <div class="collapse" id="expandableDiv-${id}">
                <div class="card border-0 bg-transparent">
                    <div class="card-body mt-2">
                    <UL>
                    ${details}
                    </UL>
                    </div>
                </div>
            </div>`

        row["links"] = `<A HREF="${row["id"]}" target="_blank"><IMG width="24" SRC="img/openalex.png" title="Open in OpenAlex"></A>`;
        if(row["orcid"]){ 
            row["links"] = `<A HREF="${row["orcid"]}" target="_blank"><IMG width="24" SRC="img/orcid.png" title="Open in ORCID"></A>` + row["links"];
        }
    }

    //Select Columns 
    columns= [
            {name: "researcher", formatter: (cell) => gridjs.html(cell)},
            {name: "display_name",hidden: true},
            {name: "affiliation",hidden: true},
            {name: "title", hidden: true},
            {name: "unit", hidden: true},
            {name: "org", hidden: true},
            {name: "paper_count", formatter: (cell) => gridjs.html(cell)},
            {name: "citation_count", formatter: (cell) => gridjs.html(cell)},
            {name: "links", formatter: (cell) => gridjs.html(cell)}
        ]

    //Select Data
    griddata = data.map(row => columns.map(col => row[col.name]));
        
    // Initialize Grid.js
    new gridjs.Grid({
        columns: columns,
        data: griddata,
        search: true,
        sort: true,
        pagination: false
    }).render(document.getElementById("grid"));
    })
    .catch(error => {
    console.error("Error loading CSV:", error);
    }); */

// Customize the search bar once it's rendered
/*setTimeout(() => {
    const searchContainer = document.querySelector('.gridjs-search');
    const input = searchContainer.querySelector('.gridjs-input');

    // Create label
    const label = document.createElement('span');
    label.textContent = 'Search: ';
    label.style.marginRight = '8px';

    // Create clear button
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.style.marginLeft = '8px';
    clearBtn.className = 'btn ';

    clearBtn.addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Insert label and clear button
    searchContainer.insertBefore(label, input);
    searchContainer.appendChild(clearBtn);
}, 100);*/

