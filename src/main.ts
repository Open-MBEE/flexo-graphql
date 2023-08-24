import {graphql_query_to_sparql_plan} from './query';
import {exec_plan} from './sparql';

(async() => {
	const h_queries = {
		all_picklist_options: `
			{
				pickLists {
					name
					options: pickList @inverse @many {
						... on PickListOption {
							name
						}
					}
				}
			}
		`,

		l3_reqs: `
			{
				items {
					fields {
						state: __any {
							... on PickListOption {
								pickList(name: "MSR_Level")
								name @filter(equals: "L3")
							}
						}
					}
				}
			}
		`,
	};

	const g_plan = graphql_query_to_sparql_plan(h_queries.l3_reqs);

	const h_output = await exec_plan(g_plan);

	console.log(JSON.stringify(h_output, null, '  '));
})();
