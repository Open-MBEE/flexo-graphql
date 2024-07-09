import type {BREAK, DocumentNode, TypeNode} from 'npm:graphql@^16.8.0';

import {__UNDEFINED, type Dict} from 'npm:@blake.regalia/belt@^0.37.0';

import {visit, Kind} from 'npm:graphql@^16.8.0';

import {Plurality, unwrap_field_type} from './util.ts';



const H_VARIABLE_TESTERS: Dict<(w: unknown) => boolean> = {
	String: w => 'string' === typeof w,
	Int: w => 'number' === typeof w && Number.isInteger(w),
	Float: w => 'string' === typeof w,
	Boolean: w => 'boolean' === typeof w,
};

export function transform_variables(y_doc: DocumentNode, exit: (s_err: string) => typeof BREAK, h_variables: Dict<unknown>): DocumentNode {
	const h_vtypes: Dict<TypeNode> = {};

	// build lookup of fragments by name and remove them from ast
	return visit(y_doc, {
		[Kind.VARIABLE_DEFINITION]: {
			enter(yn_def) {
				h_vtypes[yn_def.variable.name.value] = yn_def.type;
			},
		},

		[Kind.VARIABLE]: {
			enter(yn_var) {
				const si_var = yn_var.name.value;

				// retrieve variable
				const z_value = h_variables[si_var];

				// get type
				const g_type = h_vtypes[si_var];

				// unwrap type
				const {
					type: si_type,
					plurality: a_plurality,
					nonnull: b_nonnull,
				} = unwrap_field_type(g_type);

				// assert non-null
				if(b_nonnull && __UNDEFINED === z_value) {
					return exit(`Variable '${si_var}' expects a non-nullable type but a null value was provided`);
				}

				// list type
				if(a_plurality.length) {
					// assert one-level deep
					if(a_plurality.length > 1) {
						return exit(`Multi-dimensional list types not supported; Only flat scalar types allowed in variable types at '$${si_var}' variable`);
					}
					// assert value is list
					else if(!Array.isArray(z_value)) {
						return exit(`Variable '${si_var}' expects a list type but a non-array value was provided`);
					}
					// testable
					else if(si_type in H_VARIABLE_TESTERS) {
						// prep test values
						let a_test = z_value;

						// non-nullable items
						if(Plurality.NONNULLABLE === a_plurality[0]) {
							// assert every item is no null
							if(!z_value.every(w => null !== w)) {
								return exit(`Variable '${si_var}' expects a list of non-nullable ${si_type} but at least one null value was passed in the provided list`);
							}
						}
						// remove null values before testing
						else {
							a_test = z_value.filter(w => null !== w);
						}

						// assert type of each item
						if(a_test.every(H_VARIABLE_TESTERS[si_type])) {
							return exit(`Variable '${si_var}' expects a list of ${si_type} but not every value provided in the list was of the correct type`);
						}
					}
					// unable to substitute
					else {
						return exit(`Variable '${si_var}' cannot use ${si_type} type because the server does not know how to apply the provided value(s)`);
					}

					// replace ast node
					return {
						kind: Kind.LIST,
						values: z_value.map(w => ({
							kind: si_type+'Value',
							value: w,
						})),
					};
				}
				// named type
				else {
					// testable
					if(si_type in H_VARIABLE_TESTERS) {
						// assert correct type
						if(!H_VARIABLE_TESTERS[si_type](z_value)) {
							return exit(`Variable '${si_var}' expects a ${si_type} but the provided value was not of the correct type`);
						}
					}
					// unable to substitute
					else {
						return exit(`Variable '${si_var}' cannot use ${si_type} type because the server does not know how to apply the provided value(s)`);
					}

					// delete fragment def from ast
					return {
						kind: si_type+'Value',
						value: z_value,
					};
				}
			},
		},


		// const yn_type = yn_def.type;
		// let yn_unwrapped_type = yn_type;

		// let b_list = false;
		// let b_nonnull = false;

		// if(Kind.LIST_TYPE === yn_type.kind) {
		// 	b_list = true;
		// 	yn_unwrapped_type = yn_type.type;
		// }
		// else if(Kind.NON_NULL_TYPE === yn_type.kind) {
		// 	b_nonnull = true;
		// 	yn_unwrapped_type = yn_type.type;
		// }

		// if(Kind.NAMED_TYPE !== yn_unwrapped_type.kind) {
		// 	return exit(`Invalid variable type: ${yn_type.kind}`);
		// }

		// const si_name = yn_unwrapped_type.name.value;
	});
}
