import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import { isSettled, prepublishApiRequest, projectAnalysis } from './GenericFunctions';

/** How often a running audit is checked; the interval the Prepublish CLI and MCP server use. */
const POLL_INTERVAL_MS = 3000;

/*
 * Programmatic style rather than declarative: 'Audit Script' with 'Wait for
 * Result' is one POST followed by a polling loop of dependent GETs, which the
 * declarative routing cannot express, and the anonymous free tier needs the
 * credential to be optional.
 */
export class Prepublish implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Prepublish',
		name: 'prepublish',
		icon: {
			light: 'file:../../icons/prepublish.svg',
			dark: 'file:../../icons/prepublish.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] === "getAudit" ? "Get audit" : "Audit script"}}',
		description:
			'Audit a YouTube script before recording: hook, structure and pacing scores, the passages most likely to lose attention, and a rewrite for each',
		defaults: {
			name: 'Prepublish',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'prepublishApi',
				required: false,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Audit Script',
						value: 'auditScript',
						description:
							'Score a script and list the passages most likely to lose viewers, with a rewrite for each',
						action: 'Audit script',
					},
					{
						name: 'Get Audit',
						value: 'getAudit',
						description: 'Retrieve an audit by its ID',
						action: 'Get audit',
					},
				],
				default: 'auditScript',
			},

			// ----------------------------------
			//         auditScript
			// ----------------------------------
			{
				displayName: 'Video Title',
				name: 'videoTitle',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. The Lost City Nobody Was Supposed to Find',
				description: 'The working title of the video (up to 255 characters)',
				displayOptions: { show: { operation: ['auditScript'] } },
			},
			{
				displayName: 'Script Text',
				name: 'scriptText',
				type: 'string',
				typeOptions: { rows: 10 },
				required: true,
				default: '',
				description: 'The full script to audit, as it will be read aloud (at least 50 characters)',
				displayOptions: { show: { operation: ['auditScript'] } },
			},
			{
				displayName: 'Wait for Result',
				name: 'waitForResult',
				type: 'boolean',
				default: true,
				description:
					"Whether to wait until the audit finishes (usually 10 to 60 seconds) and output the full report. When off, the node outputs the audit ID straight away and you fetch the report later with 'Get Audit'.",
				displayOptions: { show: { operation: ['auditScript'] } },
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeout',
				type: 'number',
				typeOptions: { minValue: 10, maxValue: 900 },
				default: 180,
				description:
					'How long to wait for the audit to finish before the node stops waiting. The audit is checked every 3 seconds.',
				displayOptions: { show: { operation: ['auditScript'], waitForResult: [true] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { operation: ['auditScript'] } },
				options: [
					{
						displayName: 'Audience',
						name: 'audience',
						type: 'string',
						default: '',
						placeholder: 'e.g. history fans who watch long documentaries',
						description: 'Who the video is for (up to 500 characters)',
					},
					{
						displayName: 'Category',
						name: 'category',
						type: 'string',
						default: '',
						placeholder: 'e.g. history documentary',
						description: 'The niche or format of the video (up to 500 characters)',
					},
					{
						displayName: 'Direction for This Pass',
						name: 'direction',
						type: 'string',
						typeOptions: { rows: 2 },
						default: '',
						placeholder: 'e.g. keep the calm narrator tone, focus on the first minute',
						description:
							'What the audit should focus on or respect in this draft (up to 500 characters)',
					},
					{
						displayName: 'Keep Passages Unchanged',
						name: 'lockedPassages',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true },
						default: {},
						placeholder: 'Add Passage',
						description:
							'Up to 10 passages, copied exactly from the script, that the audit must not suggest changing',
						options: [
							{
								displayName: 'Passage',
								name: 'passage',
								values: [
									{
										displayName: 'Text',
										name: 'text',
										type: 'string',
										default: '',
										description:
											'The passage exactly as it appears in the script (3 to 1,500 characters)',
									},
								],
							},
						],
					},
					{
						displayName: 'Results Email',
						name: 'email',
						type: 'string',
						default: '',
						placeholder: 'e.g. nathan@example.com',
						description: 'An address Prepublish emails the finished report to',
					},
					{
						displayName: 'Video Duration (Seconds)',
						name: 'videoDuration',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 600,
						description: 'The planned length of the video in seconds',
					},
				],
			},

			// ----------------------------------
			//         getAudit
			// ----------------------------------
			{
				displayName: 'Audit ID',
				name: 'analysisId',
				type: 'string',
				required: true,
				default: '',
				description:
					"The 'analysis_id' output by 'Audit Script', or the last part of the report URL",
				displayOptions: { show: { operation: ['getAudit'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				let analysis: IDataObject;
				let analysisId: string;

				if (operation === 'getAudit') {
					analysisId = (this.getNodeParameter('analysisId', i) as string).trim();
					if (!analysisId) {
						throw new NodeOperationError(this.getNode(), "The 'Audit ID' parameter is empty", {
							itemIndex: i,
							description: "Map the 'analysis_id' field from an earlier 'Audit Script' node.",
						});
					}
					analysis = await prepublishApiRequest.call(
						this,
						'GET',
						`/api/analysis/${encodeURIComponent(analysisId)}`,
						i,
					);
				} else if (operation === 'auditScript') {
					const additional = this.getNodeParameter('additionalFields', i, {}) as {
						audience?: string;
						category?: string;
						direction?: string;
						email?: string;
						lockedPassages?: { passage?: Array<{ text?: string }> };
						videoDuration?: number;
					};
					const body: IDataObject = {
						video_title: this.getNodeParameter('videoTitle', i) as string,
						script_text: this.getNodeParameter('scriptText', i) as string,
					};
					if (additional.videoDuration !== undefined)
						body.video_duration = Math.round(additional.videoDuration);
					if (additional.category?.trim()) body.category = additional.category.trim();
					if (additional.audience?.trim()) body.audience = additional.audience.trim();
					if (additional.email?.trim()) body.email = additional.email.trim();
					const lockedPassages = (additional.lockedPassages?.passage ?? [])
						.map((entry) => (entry.text ?? '').trim())
						.filter((text) => text.length > 0);
					const direction = additional.direction?.trim() ?? '';
					if (lockedPassages.length > 0 || direction) {
						const steering: IDataObject = {};
						if (lockedPassages.length > 0) steering.locked_passages = lockedPassages;
						if (direction) steering.direction = direction;
						body.steering = steering;
					}

					analysis = await prepublishApiRequest.call(this, 'POST', '/api/analyze', i, body);
					analysisId = typeof analysis.id === 'string' ? analysis.id : '';
					if (!analysisId) {
						throw new NodeApiError(this.getNode(), analysis as JsonObject, {
							itemIndex: i,
							message: 'Prepublish started the audit but returned no audit ID',
						});
					}

					if (this.getNodeParameter('waitForResult', i) as boolean) {
						const timeoutSeconds = this.getNodeParameter('timeout', i) as number;
						const deadline = Date.now() + timeoutSeconds * 1000;
						while (!isSettled(analysis)) {
							if (Date.now() + POLL_INTERVAL_MS > deadline) {
								throw new NodeOperationError(
									this.getNode(),
									`The audit did not finish within ${timeoutSeconds} seconds`,
									{
										itemIndex: i,
										description: `It is still running on Prepublish. Raise 'Timeout (Seconds)', or fetch it later with 'Get Audit' and audit ID ${analysisId}.`,
									},
								);
							}
							await sleep(POLL_INTERVAL_MS);
							analysis = await prepublishApiRequest.call(
								this,
								'GET',
								`/api/analysis/${encodeURIComponent(analysisId)}`,
								i,
							);
						}
						if (analysis.status === 'failed') {
							const reason =
								typeof analysis.error_message === 'string' && analysis.error_message
									? analysis.error_message
									: 'Prepublish gave no reason.';
							throw new NodeOperationError(
								this.getNode(),
								'Prepublish could not finish this audit',
								{
									itemIndex: i,
									description: `${reason} Audit ID: ${analysisId}. Running the audit again usually works.`,
								},
							);
						}
					}
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation '${operation}' is not supported`,
						{
							itemIndex: i,
							description:
								"Choose 'Audit Script' or 'Get Audit'. For other Prepublish API calls, use the HTTP Request node with the 'Prepublish API' credential.",
						},
					);
				}

				returnData.push({
					json: projectAnalysis(analysis, analysisId),
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: (error as Error).message,
							...(typeof (error as NodeApiError).description === 'string'
								? { description: (error as NodeApiError).description }
								: {}),
						},
						pairedItem: { item: i },
					});
					continue;
				}
				// Both constructors hand back an error of their own class unchanged,
				// so the item index and HTTP context set by the helper survive.
				if (error instanceof NodeApiError)
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject);
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
