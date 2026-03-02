# Code Examples

This document contains code blocks in various languages.

## TypeScript Example

```typescript
interface User {
  id: number;
  name: string;
}

function greet(user: User): string {
  return `Hello, ${user.name}!`;
}
```

## Python Example

```python
def fibonacci(n: int) -> int:
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)
```

## Inline Code

You can also use `inline code` within paragraphs.
