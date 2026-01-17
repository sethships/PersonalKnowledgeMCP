// Package simple provides basic Go functions for testing parsing.
package simple

import (
	"fmt"
	"strings"
)

// Add adds two integers and returns the result.
func Add(a, b int) int {
	return a + b
}

// Greet creates a greeting message.
func Greet(name string) string {
	return fmt.Sprintf("Hello, %s!", name)
}

// processItems is a private function (lowercase).
func processItems(items []string) []string {
	result := make([]string, len(items))
	for i, item := range items {
		result[i] = strings.TrimSpace(item)
	}
	return result
}

// FormatMessage formats a message with variadic args.
func FormatMessage(format string, args ...interface{}) string {
	return fmt.Sprintf(format, args...)
}

// MultiReturn returns multiple values.
func MultiReturn(x int) (int, error) {
	if x < 0 {
		return 0, fmt.Errorf("negative value: %d", x)
	}
	return x * 2, nil
}

// NamedReturn uses named return values.
func NamedReturn(a, b int) (sum int, product int) {
	sum = a + b
	product = a * b
	return
}
