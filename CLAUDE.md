## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).



Admin peut dire, soit toutl es employes ont le meme horaries, soit ils peuvent tous definir un horaire diferent,

aussi admin peut dire si user x ou y peut definir ces conges ou pas lui meme ou changer lui meme, le patron doit pouvoir changer les horraires de chaque employe, les infos de chaque employe etc, ils doit y a voir des grades, genre les employes nont pas acces a toutes les finctiopnnalties, 

fais un truc ou le patron peut creer des grades, ou metre des permissions a certains utilistaeuers, exmple; gerer les horarries vireer ,modifier infos etc etc tu vois vrmt uin systeme complet de permissions et de grazdes pour toutes les fonctionalites de lapp