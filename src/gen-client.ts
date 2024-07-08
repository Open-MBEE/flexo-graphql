import type {Dict} from 'npm:@blake.regalia/belt@^0.37.0';
import type {ObjectTypeDefinitionNode} from 'npm:graphql@^16.8.0';

import {readAll} from 'https://deno.land/std@0.224.0/streams/read_all.ts';
import {Kind, parse, visit} from 'npm:graphql@^16.8.0';

import {A_SCALARS} from './constants.ts';


const group = (sx_decl: string, a_statements: string[]) => `${sx_decl} {${a_statements.map(s => `\n  ${s}`).join('')}\n}\n\n`;

const pascal = (s_name: string) => s_name[0].toUpperCase()+s_name.slice(1);

const camel = (s_name: string) => s_name[0].toLowerCase()+s_name.slice(1);

(async() => {
	const s_body = new TextDecoder().decode(await readAll(Deno.stdin));

	const y_doc = parse(s_body);

	// working type lookup
	const h_types: Dict<ObjectTypeDefinitionNode> = {};

	let s_out = '';

	const as_queued = new Set<string>();

	visit(y_doc, {
		enter(y_node, si_key, y_parent, a_path, a_ancestors) {
			// object type def
			if(Kind.OBJECT_TYPE_DEFINITION === y_node.kind) {
				// type's name
				const s_name = y_node.name.value;

				// skip types that do not include @object directive
				if(!y_node.directives?.find(g => 'object' === g.name.value)) return false;

				// create fragment
				const si_fragment = `${camel(s_name)}Info`;

				const a_fragments = [];
				for(const g_field of y_node.fields || []) {
					if(Kind.NAMED_TYPE === g_field.type.kind) {
						if(A_SCALARS.includes(g_field.type.name.value)) {
							a_fragments.push(g_field.name.value);
						}
						// else {
						// 	a_fragments.push(g_field.name.value+' { id }');
						// }
					}
				}

				s_out += group(`fragment ${si_fragment} on ${s_name}`, a_fragments);

				// get all
				s_out += group(`query GetAll${s_name}s`, [
					`${camel(s_name)}s { ...${si_fragment} }`,
				]);

				// capture fields
				for(const y_field of y_node.fields || []) {
					const si_field = y_field.name.value;

					let y_type = y_field.type;

					// unwrap list type
					if(Kind.LIST_TYPE === y_type.kind) {
						y_type = y_type.type;
					}

					// field is singular named type
					if(Kind.NAMED_TYPE === y_type.kind) {
						const s_type = y_type.name.value;

						let s_plurality = 's';
						let s_predicate = 'By';

						// non-primitive object reference
						if(!A_SCALARS.includes(s_type)) {
							as_queued.add(s_type);

							// do not produce query
							continue;
						}
						// boolean primitive
						else if('Boolean' === s_type) {
							s_out += group(`query GetOnly${pascal(si_field)}${s_name}s($${si_field}: ${s_type} = true)`, [
								`${camel(s_name)}(${si_field}: $${si_field}) { ...${si_fragment} }`,
							]);

							continue;
						}
						// ID type or @unique directive
						else if('ID' === s_type || y_field.directives?.find(g => 'unique' === g.name.value)) {
							s_plurality = '';
							s_predicate = 'At';
						}
						// any other primitive
						else {
							s_predicate = 'Having';
						}

						// produce query
						s_out += group(`query Get${s_name}${s_plurality}${s_predicate}${pascal(si_field)}($${si_field}: ${s_type})`, [
							`${camel(s_name)}${s_plurality}(${si_field}: $${si_field}) { ...${si_fragment} }`,
						]);
					}
				}
			}
			// root document
			else if(Kind.DOCUMENT === y_node.kind) {
				return;
			}

			// otherwise, do not recurse into node
			return false;
		},

		// leave(y_node, si_key, y_parent, a_path, a_ancestors) {
		//    console.log(y_node.kind);
		//    return false;
		// },
	});

	// for Boolean fields, create a GetAll${field_name}${type}s query
	// for ID fields, create a Get${type}At${field} query
	// for named type fields, create a Get${type}By${field} query
	// for all other fields, create a Get${type}sHaving${field} query

	console.log(s_out);
})();
