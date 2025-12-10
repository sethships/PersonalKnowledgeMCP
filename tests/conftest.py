"""
Pytest configuration and fixtures for Personal Knowledge MCP tests
"""
import pytest
from typing import AsyncGenerator


@pytest.fixture(scope="session")
def test_config() -> dict:
    """Provide test configuration"""
    return {
        "instance_name": "test",
        "qdrant_host": "localhost",
        "qdrant_port": 6333,
        "openai_api_key": "test-key",
    }


@pytest.fixture
async def mcp_client() -> AsyncGenerator:
    """Provide MCP client for testing"""
    # TODO: Implement once MCP service is created
    yield None


@pytest.fixture
async def vector_db_client() -> AsyncGenerator:
    """Provide vector database client for testing"""
    # TODO: Implement once Qdrant integration is created
    yield None


@pytest.fixture
def sample_code_snippet() -> str:
    """Provide sample code for testing"""
    return '''
def calculate_fibonacci(n: int) -> int:
    """Calculate the nth Fibonacci number."""
    if n <= 1:
        return n
    return calculate_fibonacci(n - 1) + calculate_fibonacci(n - 2)
'''


@pytest.fixture
def sample_markdown_doc() -> str:
    """Provide sample markdown document for testing"""
    return '''
# Test Document

This is a test document for knowledge ingestion.

## Section 1

Sample content about software architecture.

## Section 2

More content about testing strategies.
'''
