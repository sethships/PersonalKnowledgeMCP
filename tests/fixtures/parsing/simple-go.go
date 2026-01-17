// Package parsing provides test fixtures for Go AST parsing.
//
// This package demonstrates various Go constructs for tree-sitter parsing tests.
package parsing

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"

	customalias "path/filepath"
	_ "database/sql" // blank import for side effects
)

// SimpleFunction is a simple function with no parameters.
func SimpleFunction() string {
	return "hello"
}

// FunctionWithParams is a function with typed parameters.
func FunctionWithParams(name string, count int) string {
	result := ""
	for i := 0; i < count; i++ {
		result += fmt.Sprintf("Hello, %s!\n", name)
	}
	return result
}

// FunctionWithMultipleReturns returns multiple values.
func FunctionWithMultipleReturns(value int) (int, error) {
	if value < 0 {
		return 0, fmt.Errorf("value must be non-negative")
	}
	return value * 2, nil
}

// FunctionWithNamedReturns uses named return values.
func FunctionWithNamedReturns(a, b int) (sum int, product int) {
	sum = a + b
	product = a * b
	return
}

// FunctionWithVariadic accepts variadic arguments.
func FunctionWithVariadic(prefix string, values ...int) []string {
	result := make([]string, len(values))
	for i, v := range values {
		result[i] = fmt.Sprintf("%s%d", prefix, v)
	}
	return result
}

// privateHelper is an unexported helper function.
func privateHelper(value int) int {
	return value * 2
}

// Point represents a 2D point.
type Point struct {
	X float64
	Y float64
}

// NewPoint creates a new Point.
func NewPoint(x, y float64) *Point {
	return &Point{X: x, Y: y}
}

// Distance calculates the distance from origin.
func (p *Point) Distance() float64 {
	return p.X*p.X + p.Y*p.Y
}

// Scale multiplies point coordinates by a factor.
func (p *Point) Scale(factor float64) {
	p.X *= factor
	p.Y *= factor
}

// Animal is an interface for animals.
type Animal interface {
	Speak() string
	Name() string
}

// Dog represents a dog.
type Dog struct {
	name  string
	breed string
}

// NewDog creates a new Dog.
func NewDog(name, breed string) *Dog {
	return &Dog{name: name, breed: breed}
}

// Speak returns the sound a dog makes.
func (d *Dog) Speak() string {
	return fmt.Sprintf("%s says woof!", d.name)
}

// Name returns the dog's name.
func (d *Dog) Name() string {
	return d.name
}

// Fetch makes the dog fetch an item.
func (d *Dog) Fetch(item string) string {
	return fmt.Sprintf("%s fetches %s", d.name, item)
}

// Calculator provides arithmetic operations.
type Calculator struct {
	memory int
	mu     sync.Mutex
}

// Add adds two numbers.
func (c *Calculator) Add(a, b int) int {
	return a + b
}

// Multiply multiplies two numbers.
func (c *Calculator) Multiply(a, b int) int {
	return a * b
}

// Store stores a value in memory.
func (c *Calculator) Store(value int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.memory = value
}

// Recall recalls the stored value.
func (c *Calculator) Recall() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.memory
}

// FunctionWithCalls demonstrates function calls.
func FunctionWithCalls() {
	// Direct function call
	result := SimpleFunction()
	fmt.Println(result)

	// Function call with arguments
	greeting := FunctionWithParams("World", 3)
	fmt.Println(greeting)

	// Multiple return values
	doubled, err := FunctionWithMultipleReturns(5)
	if err != nil {
		fmt.Println("Error:", err)
	}
	fmt.Println(doubled)

	// Method calls
	calc := &Calculator{}
	sum := calc.Add(1, 2)
	fmt.Println(sum)

	// Package function calls
	path := customalias.Join("path", "to", "file")
	fmt.Println(path)

	// Chained method calls
	point := NewPoint(3, 4)
	point.Scale(2)
	dist := point.Distance()
	fmt.Println(dist)

	// Standard library calls
	data, _ := json.Marshal(map[string]int{"value": 42})
	fmt.Println(string(data))
}

// HTTPHandler demonstrates an HTTP handler function.
func HTTPHandler(w http.ResponseWriter, r *http.Request) {
	io.WriteString(w, "Hello, World!")
}

// ContextFunction demonstrates context usage.
func ContextFunction(ctx context.Context, value string) (string, error) {
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	default:
		return "processed: " + value, nil
	}
}

// GenericFunction demonstrates Go generics (Go 1.18+).
func GenericFunction[T any](items []T) int {
	return len(items)
}

// Pair is a generic struct.
type Pair[K comparable, V any] struct {
	Key   K
	Value V
}

// NewPair creates a new Pair.
func NewPair[K comparable, V any](key K, value V) Pair[K, V] {
	return Pair[K, V]{Key: key, Value: value}
}

// Module-level variable declarations
var (
	globalConfig = make(map[string]string)
	initialized  = false
)

// init initializes the module.
func init() {
	globalConfig["version"] = "1.0.0"
	initialized = true
}

// GetEnvWithDefault gets an environment variable with a default.
func GetEnvWithDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
