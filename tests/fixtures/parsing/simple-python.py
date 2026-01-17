"""
A simple Python module for testing AST parsing.

This module demonstrates various Python constructs for tree-sitter parsing tests.
"""

import os
import sys
from typing import Optional, List, Dict
from collections import defaultdict
from dataclasses import dataclass
import json as json_module
from pathlib import Path as PathAlias


def simple_function() -> str:
    """A simple function with no parameters."""
    return "hello"


def function_with_params(name: str, count: int = 5) -> str:
    """
    A function with typed parameters and a default value.

    Args:
        name: The name to greet
        count: Number of times to repeat

    Returns:
        The greeting string
    """
    return f"Hello, {name}!" * count


async def async_fetch_data(url: str, timeout: Optional[int] = None) -> Dict[str, str]:
    """An async function demonstrating async/await pattern."""
    # Simulated async operation
    return {"url": url, "status": "ok"}


def function_with_args_kwargs(*args, **kwargs) -> List:
    """A function with variadic arguments."""
    return list(args) + list(kwargs.values())


def private_helper(value: int) -> int:
    """A non-exported helper function."""
    return value * 2


@dataclass
class DataPoint:
    """A simple dataclass for data storage."""

    x: float
    y: float
    label: str = "unknown"


class Animal:
    """Base class for all animals."""

    def __init__(self, name: str):
        """Initialize the animal with a name."""
        self.name = name

    def speak(self) -> str:
        """Make the animal speak."""
        raise NotImplementedError("Subclasses must implement speak()")


class Dog(Animal):
    """A dog that extends Animal."""

    def __init__(self, name: str, breed: str):
        """Initialize a dog with name and breed."""
        super().__init__(name)
        self.breed = breed

    def speak(self) -> str:
        """Dogs bark."""
        return f"{self.name} says woof!"

    def fetch(self, item: str) -> str:
        """Fetch an item."""
        return f"{self.name} fetches {item}"


class Calculator:
    """A simple calculator class with static methods."""

    @staticmethod
    def add(a: int, b: int) -> int:
        """Add two numbers."""
        return a + b

    @staticmethod
    def multiply(a: int, b: int) -> int:
        """Multiply two numbers."""
        return a * b

    @classmethod
    def from_string(cls, expr: str) -> "Calculator":
        """Create calculator from string expression."""
        return cls()


# Module-level function calls for testing call extraction
result = simple_function()
calculator = Calculator()
sum_result = Calculator.add(5, 3)


def function_with_calls() -> None:
    """Function that calls other functions."""
    data = simple_function()
    processed = private_helper(42)
    calc = Calculator()
    result = calc.add(1, 2)

    # Async call (though not awaited in this non-async context)
    # async_fetch_data("https://example.com")

    # Method chaining
    path = Path("/home").joinpath("user").resolve()


async def async_caller() -> str:
    """Async function that awaits other async functions."""
    data = await async_fetch_data("https://api.example.com", timeout=30)
    return data.get("status", "unknown")
