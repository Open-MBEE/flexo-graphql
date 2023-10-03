import type {Dict} from 'npm:@blake.regalia/belt@^0.15.0';
import type {BREAK, DocumentNode, TypeNode} from 'npm:graphql@^16.8.0';

import {visit, Kind} from 'npm:graphql@^16.8.0';



const H_VARIABLE_TESTERS: Dict<(w: any) => boolean> = {
	String: w => 'string' === typeof w,
	Int: w => 'number' === typeof w && Number.isInteger(w),
	Float: w => 'string' === typeof w,
	Boolean: w => 'boolean' === typeof w,
};

export function transform_variables(y_doc: DocumentNode, exit: (s_err: string) => typeof BREAK, h_variables: Dict<any>): DocumentNode {
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
				const w_value = h_variables[si_var];

				// get type
				let g_type = h_vtypes[si_var];

				// unwrap non-null type
				let b_nonnull = false;
				if(Kind.NON_NULL_TYPE === g_type.kind) {
					b_nonnull = true;
					g_type = g_type.type;
				}

				// list value
				if(Kind.LIST_TYPE === g_type.kind) {
					// assert type
					if(Kind.NAMED_TYPE !== g_type.type.kind) {
						return exit(`Only flat, nullable scalar types allowed in variable types at '$${si_var}' variable`);
					}

					// assert value is list
					if(!Array.isArray(w_value)) {
						return exit(`Variable '${si_var}' expects a list type but a non-array value was provided`);
					}

					// ref scalar type
					const si_type = g_type.type.name.value;

					// testable
					if(si_type in H_VARIABLE_TESTERS) {
						// nullable?
						let a_test =(w_value as any[]);
						if(b_nonnull) {
							if(!a_test.every(w => null !== w)) {
								return exit(`Variable '${si_var}' expects a list of non-nullable ${si_type} but at least one null value was passed in the provided list`);
							}
						}
						// remove null values before testing
						else {
							a_test = a_test.filter(w => null !== w);
						}

						if(a_test.every(H_VARIABLE_TESTERS[si_type])) {
							return exit(`Variable '${si_var}' expects a list of ${si_type} but not every value provided in the list was of the correct type`);
						}
					}
					// unable to substitue
					else {
						return exit(`Variable '${si_var}' cannot use ${si_type} type because the server does not know how to apply the provided value(s)`);
					}

					return {
						kind: Kind.LIST,
						values: w_value.map(w => ({
							kind: si_type+'Value',
							value: w,
						})),
					};
				}
				// named type
				else {
					// ref scalar type
					const si_type = g_type.name.value;

					// testable
					if(si_type in H_VARIABLE_TESTERS) {
						if(!H_VARIABLE_TESTERS[si_type](w_value)) {
							return exit(`Variable '${si_var}' expects a ${si_type} but the provided value was not of the correct type`);
						}
					}
					// unable to substitue
					else {
						return exit(`Variable '${si_var}' cannot use ${si_type} type because the server does not know how to apply the provided value(s)`);
					}

					// delete fragment def from ast
					return {
						kind: si_type+'Value',
						value: w_value,
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