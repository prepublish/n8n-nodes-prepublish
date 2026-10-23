import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class PrepublishApi implements ICredentialType {
	name = 'prepublishApi';

	displayName = 'Prepublish API';

	icon: Icon = { light: 'file:../icons/prepublish.svg', dark: 'file:../icons/prepublish.dark.svg' };

	documentationUrl = 'https://www.npmjs.com/package/n8n-nodes-prepublish#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'e.g. pp_live_...',
			description:
				'Create a key at https://prepublish.ai/dashboard (API keys come with the paid plans)',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.prepublish.ai',
			description: 'Leave as is. Change it only to point the node at a Prepublish test server.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{($credentials.baseUrl || "https://api.prepublish.ai").replace(/\\/+$/, "")}}',
			url: '/api/auth/me',
			method: 'GET',
		},
	};
}
