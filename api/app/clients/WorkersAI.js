const axios = require('axios');
const { logger } = require('~/config');

class WorkersAIClient {
  /**
   * Fetches Workers AI models from the specified base API path.
   * @param {string} baseURL
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
      const parsedURL = new URL(baseURL);
      switch (parsedURL.hostname) {
        case 'api.cloudflare.com':
          if (parsedURL.pathname.endsWith('/v1')) {
            parsedURL.pathname = parsedURL.pathname.slice(0, -3);
          }
          parsedURL.pathname += '/models/search';
          break;
        case 'gateway.ai.cloudflare.com':
          parsedURL.pathname = parsedURL.pathname
            .split('/')
            .filter((_, i) => i < 4)
            .concat('workers-ai', 'models', 'search')
            .join('/');
          break;
        default:
          return models;
      }
      const endpoint = parsedURL.toString();

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
}

module.exports = { WorkersAIClient };
