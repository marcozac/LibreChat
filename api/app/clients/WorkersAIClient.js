const axios = require('axios');
const { fetchEventSource } = require('@waylaidwanderer/fetch-event-source');
const { sleep } = require('~/server/utils');
const { logger } = require('~/config');

class WorkersAIClient {
  /**
   * @param {Object} options
   * @param {string} options.baseURL The base URL of the Workers AI API.
   * @param {string} options.apiKey The API key for the Workers AI API.
   * @param {number} [options.streamRate] The rate at which to stream messages.
   */
  constructor(options) {
    const { baseURL, apiKey, ...opts } = options;
    this.baseURL = formatBaseURL(baseURL) + '/run'; // seems that even the gateway supports /run
    this.apiKey = apiKey;
    this.setOptions(opts);
  }

  /**
   * @param {Object} options
   * @param {number} [options.streamRate] The rate at which to stream messages.
   */
  setOptions(options) {
    /**
     * @TODO
     * Add specific model options (e.g. unscoped prompts).
     */

    this.options = { ...options };
  }

  /**
   * Fetches Workers AI models from the specified base API path.
   * @param {string} baseURL
   * @param {string} apiKey
   * @returns {Promise<string[]>} The Workers AI models.
   */
  static async fetchModels(baseURL, apiKey) {
    let models = [];
    if (!baseURL || !apiKey) {
      return models;
    }
    try {
      const options = {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      };

      const endpoint = formatBaseURL(baseURL) + '/models/search';

      /** @type {AxiosResponse<WorkersAIModelListResponse>} */
      const response = await axios.get(endpoint, options);
      models = response.data.result
        .filter((m) => m.task.name === 'Text Generation')
        .map((m) => m.name);
      return models;
    } catch (error) {
      const logMessage =
        'Failed to fetch models from Workers AI API. If you are not using Workers AI directly, and instead, through some aggregator or reverse proxy that handles fetching via OpenAI spec, ensure the name of the endpoint doesn\'t start with `workersai` (case-insensitive).'; // prettier-ignore
      logger.error(logMessage, error);
      return [];
    }
  }

  /**
   * @param {Object} params
   * @param {ChatCompletionPayload} params.payload
   * @param {onTokenProgress} params.onProgress
   * @param {AbortController} params.abortController
   *
   * @returns {Promise<string>}
   */
  async chatCompletion({ payload, onProgress, abortController = null }) {
    abortController = abortController ?? new AbortController();

    const options = {
      ...this.options,
      endpoint: `${this.baseURL}/${payload.model}`,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    };

    if (payload.stream) {
      // eslint-disable-next-line no-async-promise-executor
      return new Promise(async (resolve, reject) => {
        try {
          let intermediateReply = '';
          let done = false;
          fetchEventSource(options.endpoint, {
            method: 'POST',
            headers: {
              ...options.headers,
              Accept: 'text/event-stream',
            },
            body: JSON.stringify(payload),
            signal: abortController.signal,
            async onopen(response) {
              if (response.status === 200) {
                return;
              }
              logger.debug('[WorkersAIClient.chatCompletion]', response);
              const err = new Error(`Failed to send message. HTTP ${response.status}`);
              err.status = response.status;
              try {
                const body = await response.text();
                err.message += ` - ${body}`;
                err.json = JSON.parse(body);
                // eslint-disable-next-line no-empty
              } catch {}
              logger.error('[WorkersAIClient.chatCompletion]', err);
              throw err;
            },
            onclose() {
              // workaround for private API not sending [DONE] event
              if (!done) {
                onProgress('[DONE]');
                resolve(intermediateReply);
              }
            },
            onerror(err) {
              logger.error('[WorkersAIClient.chatCompletion]', err);
              // rethrow to stop the operation
              throw err;
            },
            async onmessage(message) {
              logger.debug('[WorkersAIClient.chatCompletion]', message);
              if (!message.data || message.event === 'ping') {
                return;
              }
              if (message.data === '[DONE]') {
                onProgress('[DONE]');
                resolve(intermediateReply);
                done = true;
                return;
              }

              /** @type {WorkersAIChatCompletionMessage} */
              const { response: msg } = JSON.parse(message.data);
              onProgress(msg);
              intermediateReply += msg;

              await sleep(options.streamRate);
            },
          });
        } catch (err) {
          reject(err);
        }
      });
    }

    /** @type {AxiosResponse<WorkersAIResponseBase<WorkersAIChatCompletionMessage>>} */
    const response = await axios.default.post(options.endpoint, payload, {
      headers: options.headers,
      signal: abortController.signal,
    });
    if (response.status !== 200 || !response.data?.success) {
      const err = new Error(
        `Failed to get completion. HTTP ${response.status} - ${JSON.stringify(response.data)}`,
      );
      err.status = response.status;
      err.json = response.data;
      logger.error('[WorkersAIClient.chatCompletion]', err);
      throw err;
    }
    return response.data.result.response;
  }
}

/**
 * Format the base URL for the Workers AI API.
 * @param {string} baseURL The base URL as in the endpoint configuration.
 * @returns {string} The formatted base URL.
 */
const formatBaseURL = (baseURL) => {
  const parsedURL = new URL(baseURL);
  switch (parsedURL.hostname) {
    case 'api.cloudflare.com':
      parsedURL.pathname = parsedURL.pathname
        .split('/')
        .filter((_, i) => i < 6)
        .join('/');
      break;
    case 'gateway.ai.cloudflare.com':
      parsedURL.pathname = parsedURL.pathname
        .split('/')
        .filter((_, i) => i < 4)
        .concat('workers-ai')
        .join('/');
      break;
  }
  return parsedURL.toString();
};

module.exports = { WorkersAIClient };
