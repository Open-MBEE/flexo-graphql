/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type {ScalarType} from './constants.ts';
import type {Dict} from 'npm:@blake.regalia/belt@^0.15.0';
import type {BREAK, DocumentNode, FieldDefinitionNode, InputValueDefinitionNode} from 'npm:graphql@^16.8.0';

import {Kind, parse, visit} from 'npm:graphql@^16.8.0';

import {A_SCALARS, H_SCALAR_FILTER_ARGUMENTS, graphql_name, graphql_named_type} from './constants.ts';
import {unwrap_field_type} from './util.ts';

export function transform_add_object_filters(y_doc: DocumentNode): DocumentNode {
	// collect all object types first
	const h_objects: Dict<InputValueDefinitionNode[]> = {};
	visit(y_doc, {
		[Kind.OBJECT_TYPE_DEFINITION]: {
			enter(yn_type) {
				// prep list of scalar fields
				const a_scalar_args: InputValueDefinitionNode[] = [];

				// each field
				for(const yn_field of yn_type.fields || []) {
					const si_type = unwrap_field_type(yn_field.type).type as ScalarType;

					// scalar; add it to list
					if(A_SCALARS.includes(si_type)) {
						a_scalar_args.push({
							kind: Kind.INPUT_VALUE_DEFINITION,
							name: graphql_name(yn_field.name.value),
							type: graphql_named_type(si_type),
						});
					}
				}

				// save to objects dict
				h_objects[yn_type.name.value] = a_scalar_args;
			},
		},
	});

	return visit(y_doc, {
		// each object type definition
		[Kind.OBJECT_TYPE_DEFINITION]: {
			enter(yn_type) {
				// replace fields
				const a_fields: FieldDefinitionNode[] = [];

				// each field
				for(const yn_field of yn_type.fields || []) {
					const si_type = unwrap_field_type(yn_field.type).type;

					// only fields that use object types
					if(h_objects[si_type]) {
						(yn_field.arguments as InputValueDefinitionNode[]) = h_objects[si_type];
					}

					// transform into filter function
					a_fields.push(yn_field);
				}

				// transform type node
				return {
					...yn_type,
					fields: a_fields,
				};
			},
		},
	});
}
