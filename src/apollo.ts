import {ApolloServer} from 'npm:apollo-server@^3.12.0';

export class SchemaHandler {
	protected _y_server: ApolloServer;

	constructor(sx_types: string) {
		this._y_server = new ApolloServer({
			typeDefs: sx_types,
			resolvers: {},
		});
	}

	async handle(sx_query: string): ReturnType<ApolloServer['executeOperation']> {
		const g_res = await this._y_server.executeOperation({
			query: sx_query,
		});

		return g_res;
	}
}

