import type {ScalarType} from './constants.ts';
import type {BREAK, DocumentNode, FieldDefinitionNode, InputValueDefinitionNode} from 'npm:graphql@^16.8.0';

import {Kind, parse, visit} from 'npm:graphql@^16.8.0';

import {A_SCALARS, H_SCALAR_FILTER_ARGUMENTS} from './constants.ts';
import {unwrap_field_type} from './util.ts';

export function transform_add_scalar_filters(y_doc: DocumentNode): DocumentNode {
	return visit(y_doc, {
		// each object type definition
		[Kind.OBJECT_TYPE_DEFINITION]: {
			enter(yn_type) {
				// // skip types without @object directive
				// if(!yn_type.directives?.find(g => 'object' === g.name.value)) return;

				// replace fields
				const a_fields: FieldDefinitionNode[] = [];

				// each field
				for(const yn_field of yn_type.fields || []) {
					// unwrap field type
					const {
						type: si_type,
						plurality: a_plurality,
					} = unwrap_field_type(yn_field.type);

					// only flat scalars with no arguments
					if(A_SCALARS.includes(si_type as ScalarType) && !a_plurality.length && !yn_field.arguments?.length) {
						(yn_field.arguments as InputValueDefinitionNode[]) = [H_SCALAR_FILTER_ARGUMENTS[si_type as ScalarType]];
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
