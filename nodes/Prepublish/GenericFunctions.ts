import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export const DEFAULT_BASE_URL = 'https://api.prepublish.ai';
export const REPORT_BASE_URL = 'https://prepublish.ai/analysis/';
export const DASHBOARD_URL = 'https://prepublish.ai/dashboard';
export const PRICING_URL = 'https://prepublish.ai/pricing';

const CREDENTIAL_NAME = 'prepublishApi';

/** Labels of the node parameters the API's validation errors can point at. */
const FIELD_LABELS: Record<string, string> = {
	video_title: 'Video Title',
	script_text: 'Script Text',
	video_duration: 'Video Duration (Seconds)',
	category: 'Category',
	audience: 'Audience',
	email: 'Results Email',
	'steering.direction': 'Direction for This Pass',
	'steering.locked_passages': 'Keep Passages Unchanged',
};

/** The error envelope the API sends: `{"error":{"code","message","details"}}` or `{"error":"code","message"}`. */
interface ApiFailure {
	code: string;
	message: string;
	field: string;
}

function asObject(value: unknown): IDataObject | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as IDataObject)
		: undefined;
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseBody(body: unknown): unknown {
	if (typeof body !== 'string') return body;
	try {
		return JSON.parse(body);
	} catch {
		// A body that is not JSON (an HTML page from a proxy) carries no envelope.
		return body;
	}
}

function readFailure(body: unknown): ApiFailure {
	const envelope = asObject(body);
	const failure: ApiFailure = {
		code: '',
		message: nonEmptyString(envelope?.message) ?? '',
		field: '',
	};
	if (!envelope) return failure;
	const error = envelope.error;
	if (typeof error === 'string') {
		failure.code = error;
		return failure;
	}
	const detail = asObject(error);
	if (!detail) return failure;
	if (typeof detail.code === 'string' || typeof detail.code === 'number')
		failure.code = String(detail.code);
	failure.message = nonEmptyString(detail.message) ?? failure.message;
	const field = asObject(detail.details)?.field;
	if (typeof field === 'string') failure.field = field;
	return failure;
}

/** The API base URL: the credential's override when one is set, production otherwise. */
async function getBaseUrl(this: IExecuteFunctions, authenticated: boolean): Promise<string> {
	if (!authenticated) return DEFAULT_BASE_URL;
	const credentials = await this.getCredentials(CREDENTIAL_NAME);
	const override = typeof credentials.baseUrl === 'string' ? credentials.baseUrl.trim() : '';
	return (override || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function apiError(
	this: IExecuteFunctions,
	status: number,
	body: unknown,
	authenticated: boolean,
	itemIndex: number,
): NodeApiError {
	const failure = readFailure(body);
	const errorResponse = (asObject(body) ?? { body: String(body ?? '') }) as JsonObject;
	const httpCode = String(status);
	const serverMessage = failure.message;

	if (status === 429 && failure.code === 'FREE_ANALYSIS_USED') {
		return new NodeApiError(this.getNode(), errorResponse, {
			itemIndex,
			httpCode,
			message: authenticated
				? 'The daily audit limit on this Prepublish account is used up'
				: 'The free daily Prepublish audits from this network are used up',
			description: authenticated
				? `${serverMessage ? `${serverMessage} ` : ''}Plans and limits: ${PRICING_URL}`
				: `Without an API key Prepublish allows 3 audits a day per IP address. Add an API key from ${DASHBOARD_URL} to the 'Prepublish API' credential on this node to keep auditing (the Creator plan covers up to 50 scripts a day).`,
		});
	}

	if (status === 401) {
		return new NodeApiError(this.getNode(), errorResponse, {
			itemIndex,
			httpCode,
			message: 'Prepublish did not accept the API key',
			description: `Check the key in the 'Prepublish API' credential, or create a new one at ${DASHBOARD_URL}.`,
		});
	}

	if (status === 400 && failure.field) {
		const label = FIELD_LABELS[failure.field] ?? failure.field;
		return new NodeApiError(this.getNode(), errorResponse, {
			itemIndex,
			httpCode,
			message: `Prepublish did not accept the '${label}' parameter`,
			description: serverMessage || undefined,
		});
	}

	return new NodeApiError(this.getNode(), errorResponse, {
		itemIndex,
		httpCode,
		message: serverMessage || undefined,
	});
}

/**
 * One call to the Prepublish API. With a credential selected the request is
 * signed with its key; without one it goes out anonymously, which the API
 * serves on the free tier. Non-2xx answers become a NodeApiError that says what
 * happened and how to get unstuck.
 */
export async function prepublishApiRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	itemIndex: number,
	body?: IDataObject,
): Promise<IDataObject> {
	// Credentials are optional on this node: without one the call goes out anonymously.
	const authenticated = Boolean(this.getNode().credentials?.[CREDENTIAL_NAME]);
	const options: IHttpRequestOptions = {
		method,
		baseURL: await getBaseUrl.call(this, authenticated),
		url: path,
		headers: { Accept: 'application/json' },
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (body) options.body = body;

	let response: IN8nHttpFullResponse;
	try {
		response = (
			authenticated
				? await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_NAME, options)
				: await this.helpers.httpRequest(options)
		) as IN8nHttpFullResponse;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
	}

	const payload = parseBody(response.body);
	if (response.statusCode < 200 || response.statusCode >= 300) {
		throw apiError.call(this, response.statusCode, payload, authenticated, itemIndex);
	}
	const record = asObject(payload);
	if (!record) {
		throw new NodeApiError(
			this.getNode(),
			{ body: String(payload ?? '') },
			{
				itemIndex,
				message: 'Prepublish answered with an unexpected response',
				description: `Expected a JSON object from ${method} ${path}.`,
			},
		);
	}
	// The analysis DTO is flat; a wrapped body is unwrapped the same way the MCP server does.
	const inner = asObject(record.data);
	return typeof record.status !== 'string' && inner ? inner : record;
}

export function isSettled(analysis: IDataObject): boolean {
	return analysis.status === 'completed' || analysis.status === 'failed';
}

const SCALARS: Record<string, 'string' | 'number' | 'boolean'> = {
	video_title: 'string',
	status: 'string',
	error_message: 'string',
	overall_score: 'number',
	hook_score: 'number',
	structure_score: 'number',
	pacing_score: 'number',
	ready_to_record: 'boolean',
	one_key_improvement: 'string',
	lock_reason: 'string',
	created_at: 'string',
};

const IMPROVEMENT_FIELDS = [
	'priority',
	'category',
	'title',
	'timestamp',
	'original_quote',
	'improved',
	'why',
] as const;

function projectImprovements(items: unknown): IDataObject[] {
	if (!Array.isArray(items)) return [];
	const projected: IDataObject[] = [];
	for (const entry of items) {
		const item = asObject(entry);
		if (!item) continue;
		const kept: IDataObject = {};
		for (const key of IMPROVEMENT_FIELDS) {
			const value = nonEmptyString(item[key]);
			if (value) kept[key] = value;
		}
		// Always present: a locked fix has no `improved` or `why` on this plan.
		kept.locked = item.locked === true;
		projected.push(kept);
	}
	return projected;
}

function projectPolicyPreflight(preflight: IDataObject): IDataObject {
	const projected: IDataObject = {};
	const verdict = nonEmptyString(preflight.verdict);
	if (verdict) projected.verdict = verdict;
	if (typeof preflight.total_flags === 'number') projected.total_flags = preflight.total_flags;
	const counts = asObject(preflight.counts_by_category);
	if (counts) projected.counts_by_category = counts;
	// The API omits `locked` when the passages are included.
	projected.locked = preflight.locked === true;
	const scope = nonEmptyString(preflight.scope_statement);
	if (scope) projected.scope_statement = scope;
	return projected;
}

/**
 * The audit as clean JSON for the next node: scores, the verdict, the flagged
 * passages and how many of them this plan left locked, plus the report link.
 * The script text and internal bookkeeping are never passed on.
 */
export function projectAnalysis(analysis: IDataObject, fallbackId: string): IDataObject {
	const id = nonEmptyString(analysis.id) ?? fallbackId;
	const projected: IDataObject = { analysis_id: id };
	for (const [key, kind] of Object.entries(SCALARS)) {
		const value = analysis[key];
		const keep =
			kind === 'string'
				? typeof value === 'string' && value.length > 0
				: kind === 'number'
					? typeof value === 'number' && Number.isFinite(value)
					: typeof value === 'boolean';
		if (keep) projected[key] = value;
	}

	if (!isSettled(analysis) && typeof analysis.progress === 'number') {
		projected.progress = analysis.progress;
	}

	if (analysis.status === 'completed') {
		const explanations = asObject(analysis.score_explanations);
		if (explanations) {
			const kept: IDataObject = {};
			for (const key of ['hook', 'structure', 'pacing']) {
				const text = nonEmptyString(explanations[key]);
				if (text) kept[key] = text;
			}
			if (Object.keys(kept).length > 0) projected.score_explanations = kept;
		}
		const improvements = projectImprovements(analysis.improvements);
		projected.improvements = improvements;
		projected.locked_count = improvements.filter((item) => item.locked === true).length;
		projected.locked = analysis.locked === true;
		const preflight = asObject(analysis.policy_preflight);
		if (preflight) projected.policy_preflight = projectPolicyPreflight(preflight);
	}

	projected.report_url = `${REPORT_BASE_URL}${encodeURIComponent(id)}`;
	return projected;
}
