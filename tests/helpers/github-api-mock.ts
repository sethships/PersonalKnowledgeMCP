/**
 * Mock helper for GitHub API
 *
 * Provides a configurable mock for testing GitHub client without
 * making real HTTP requests.
 */

import {
  createMockCommitResponse,
  createMockCompareResponse,
  createMockRateLimitResponse,
  MOCK_ERROR_RESPONSES,
  type MockCommitResponse,
  type MockCompareResponse,
  type MockRateLimitResponse,
} from "../fixtures/github-fixtures.js";

/**
 * Call log entry for tracking API calls
 */
export interface GitHubAPICallLog {
  method: string;
  url: string;
  headers: Record<string, string>;
  timestamp: number;
}

/**
 * Mock fetch response configuration
 */
export interface MockFetchResponse {
  status: number;
  statusText: string;
  body: unknown;
  headers?: Headers;
}

/**
 * Mock GitHub API client for testing
 *
 * Intercepts fetch calls and returns configured responses.
 * Tracks all API calls for verification in tests.
 */
export class MockGitHubAPI {
  private callLog: GitHubAPICallLog[] = [];
  private shouldFail = false;
  private failureResponse: MockFetchResponse | null = null;
  private failuresRemaining = 0;
  private commitResponse: MockCommitResponse | null = null;
  private compareResponse: MockCompareResponse | null = null;
  private rateLimitResponse: MockRateLimitResponse | null = null;
  private originalFetch: typeof global.fetch;

  constructor() {
    this.originalFetch = global.fetch;
  }

  /**
   * Install the mock by replacing global fetch
   */
  install(): void {
    global.fetch = this.mockFetch.bind(this) as typeof global.fetch;
  }

  /**
   * Uninstall the mock and restore original fetch
   */
  uninstall(): void {
    global.fetch = this.originalFetch;
  }

  /**
   * Reset mock state
   */
  reset(): void {
    this.callLog = [];
    this.shouldFail = false;
    this.failureResponse = null;
    this.failuresRemaining = 0;
    this.commitResponse = null;
    this.compareResponse = null;
    this.rateLimitResponse = null;
  }

  /**
   * Set a custom commit response
   */
  setCommitResponse(response: MockCommitResponse): void {
    this.commitResponse = response;
  }

  /**
   * Set a custom compare response
   */
  setCompareResponse(response: MockCompareResponse): void {
    this.compareResponse = response;
  }

  /**
   * Set a custom rate limit response
   */
  setRateLimitResponse(response: MockRateLimitResponse): void {
    this.rateLimitResponse = response;
  }

  /**
   * Configure the mock to fail with a specific error
   */
  setFailure(response: MockFetchResponse): void {
    this.shouldFail = true;
    this.failureResponse = response;
    this.failuresRemaining = Infinity;
  }

  /**
   * Configure the mock to fail N times, then succeed
   */
  setTransientFailure(response: MockFetchResponse, failCount: number): void {
    this.shouldFail = true;
    this.failureResponse = response;
    this.failuresRemaining = failCount;
  }

  /**
   * Configure the mock to throw a network error
   */
  setNetworkError(errorMessage: string): void {
    this.shouldFail = true;
    this.failureResponse = {
      status: 0,
      statusText: "Network Error",
      body: null,
      headers: new Headers(),
    };
    // Store error message for network error simulation
    (this.failureResponse as MockFetchResponse & { networkError: string }).networkError =
      errorMessage;
    this.failuresRemaining = Infinity;
  }

  /**
   * Get all API calls made
   */
  getCallLog(): GitHubAPICallLog[] {
    return [...this.callLog];
  }

  /**
   * Get the number of API calls made
   */
  getCallCount(): number {
    return this.callLog.length;
  }

  /**
   * Get the last API call made
   */
  getLastCall(): GitHubAPICallLog | undefined {
    return this.callLog[this.callLog.length - 1];
  }

  /**
   * Check if an API call was made to a specific URL pattern
   */
  wasCalledWith(urlPattern: string | RegExp): boolean {
    return this.callLog.some((call) => {
      if (typeof urlPattern === "string") {
        return call.url.includes(urlPattern);
      }
      return urlPattern.test(call.url);
    });
  }

  /**
   * Mock fetch implementation
   */
  private async mockFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    let url: string;
    if (typeof input === "string") {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else {
      // input is a Request object
      url = input.url;
    }
    const headers: Record<string, string> = {};

    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [key, value] of init.headers) {
          if (key !== undefined && value !== undefined) {
            headers[key] = value;
          }
        }
      } else {
        Object.assign(headers, init.headers);
      }
    }

    // Log the call
    this.callLog.push({
      method: init?.method || "GET",
      url,
      headers,
      timestamp: Date.now(),
    });

    // Check for network error simulation
    if (this.shouldFail && this.failuresRemaining > 0) {
      const networkError = (this.failureResponse as MockFetchResponse & { networkError?: string })
        ?.networkError;
      if (networkError) {
        this.failuresRemaining--;
        throw new Error(networkError);
      }
    }

    // Handle transient failures
    if (this.shouldFail && this.failuresRemaining > 0 && this.failureResponse) {
      this.failuresRemaining--;
      return this.createResponse(this.failureResponse);
    }

    // Determine response based on URL
    const response = this.getResponseForUrl(url);
    return this.createResponse(response);
  }

  /**
   * Get appropriate response based on URL
   */
  private getResponseForUrl(url: string): MockFetchResponse {
    // Rate limit endpoint
    if (url.includes("/rate_limit")) {
      const body = this.rateLimitResponse || createMockRateLimitResponse();
      return {
        status: 200,
        statusText: "OK",
        body,
        headers: new Headers({
          "content-type": "application/json",
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4999",
        }),
      };
    }

    // Compare commits endpoint
    if (url.includes("/compare/")) {
      const body = this.compareResponse || createMockCompareResponse();
      return {
        status: 200,
        statusText: "OK",
        body,
        headers: new Headers({
          "content-type": "application/json",
        }),
      };
    }

    // Commit endpoint
    if (url.includes("/commits/")) {
      const body = this.commitResponse || createMockCommitResponse();
      return {
        status: 200,
        statusText: "OK",
        body,
        headers: new Headers({
          "content-type": "application/json",
        }),
      };
    }

    // Default: not found
    return MOCK_ERROR_RESPONSES.notFound;
  }

  /**
   * Create a mock Response object
   */
  private createResponse(config: MockFetchResponse): Response {
    const body = config.body ? JSON.stringify(config.body) : null;
    const headers = config.headers || new Headers({ "content-type": "application/json" });

    return new Response(body, {
      status: config.status,
      statusText: config.statusText,
      headers,
    });
  }
}

/**
 * Helper to create preconfigured error responses
 */
export const MockErrors = {
  unauthorized(): MockFetchResponse {
    return {
      status: MOCK_ERROR_RESPONSES.unauthorized.status,
      statusText: MOCK_ERROR_RESPONSES.unauthorized.statusText,
      body: MOCK_ERROR_RESPONSES.unauthorized.body,
      headers: MOCK_ERROR_RESPONSES.unauthorized.headers,
    };
  },

  forbidden(): MockFetchResponse {
    return {
      status: MOCK_ERROR_RESPONSES.forbidden.status,
      statusText: MOCK_ERROR_RESPONSES.forbidden.statusText,
      body: MOCK_ERROR_RESPONSES.forbidden.body,
      headers: MOCK_ERROR_RESPONSES.forbidden.headers,
    };
  },

  rateLimited(): MockFetchResponse {
    return {
      status: MOCK_ERROR_RESPONSES.rateLimited.status,
      statusText: MOCK_ERROR_RESPONSES.rateLimited.statusText,
      body: MOCK_ERROR_RESPONSES.rateLimited.body,
      headers: MOCK_ERROR_RESPONSES.rateLimited.headers,
    };
  },

  notFound(): MockFetchResponse {
    return {
      status: MOCK_ERROR_RESPONSES.notFound.status,
      statusText: MOCK_ERROR_RESPONSES.notFound.statusText,
      body: MOCK_ERROR_RESPONSES.notFound.body,
      headers: MOCK_ERROR_RESPONSES.notFound.headers,
    };
  },

  validationFailed(): MockFetchResponse {
    return {
      status: MOCK_ERROR_RESPONSES.validationFailed.status,
      statusText: MOCK_ERROR_RESPONSES.validationFailed.statusText,
      body: MOCK_ERROR_RESPONSES.validationFailed.body,
      headers: MOCK_ERROR_RESPONSES.validationFailed.headers,
    };
  },

  internalError(): MockFetchResponse {
    return {
      status: MOCK_ERROR_RESPONSES.internalError.status,
      statusText: MOCK_ERROR_RESPONSES.internalError.statusText,
      body: MOCK_ERROR_RESPONSES.internalError.body,
      headers: MOCK_ERROR_RESPONSES.internalError.headers,
    };
  },

  serviceUnavailable(): MockFetchResponse {
    return {
      status: MOCK_ERROR_RESPONSES.serviceUnavailable.status,
      statusText: MOCK_ERROR_RESPONSES.serviceUnavailable.statusText,
      body: MOCK_ERROR_RESPONSES.serviceUnavailable.body,
      headers: MOCK_ERROR_RESPONSES.serviceUnavailable.headers,
    };
  },
};
