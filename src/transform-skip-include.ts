import type {BREAK, DocumentNode} from 'npm:graphql@^16.8.0';

import {Kind, visit} from 'npm:graphql@^16.8.0';

export function transform_skip_include(y_doc: DocumentNode, exit: (s_err: string) => typeof BREAK): DocumentNode {
	// build lookup of fragments by name and remove them from ast
	return visit(y_doc, {
		[Kind.FIELD]: {
			enter(yn_field) {
				// handle @skip directive
				const yn_skip = yn_field.directives?.find(d => 'skip' === d.name.value);
				if(yn_skip) {
					const yn_if = yn_skip.arguments?.find(a => 'if' === a.name.value);
					if(!yn_if || (Kind.BOOLEAN === yn_if.value.kind && true === yn_if.value.value)) {
						return null;
					}
				}

				// handle @include directive
				const yn_include = yn_field.directives?.find(d => 'include' === d.name.value);
				if(yn_include) {
					const yn_if = yn_include.arguments?.find(a => 'if' === a.name.value);
					if(yn_if && (Kind.BOOLEAN === yn_if.value.kind && false === yn_if.value.value)) {
						return null;
					}
				}
			},
			// remove directive itself from field
			leave(yn_field) {
				return {
					...yn_field,
					directives: yn_field.directives?.filter(d => d.name.value !== 'skip' && d.name.value !== 'include'),
				};
			},
		},
	});
}
