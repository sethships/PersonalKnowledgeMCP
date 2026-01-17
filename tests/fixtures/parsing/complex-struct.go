// Package complex demonstrates Go structs, interfaces, and methods.
package complex

import (
	"fmt"
	"sync"
)

// DataProcessor defines the interface for data processing.
type DataProcessor interface {
	Process(data string) error
	GetStatus() string
}

// Handler is a struct with various field types.
type Handler struct {
	ID          string
	Name        string
	processCount int
	mu          sync.Mutex
}

// NewHandler creates a new Handler instance.
func NewHandler(id, name string) *Handler {
	return &Handler{
		ID:          id,
		Name:        name,
		processCount: 0,
	}
}

// Process implements the DataProcessor interface.
func (h *Handler) Process(data string) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.processCount++
	fmt.Printf("Processing %s: %s\n", h.ID, data)
	return nil
}

// GetStatus implements the DataProcessor interface.
func (h *Handler) GetStatus() string {
	return fmt.Sprintf("Handler %s processed %d items", h.ID, h.processCount)
}

// Reset resets the handler (pointer receiver).
func (h *Handler) Reset() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.processCount = 0
}

// String implements the Stringer interface.
func (h Handler) String() string {
	return fmt.Sprintf("Handler{ID: %s, Name: %s}", h.ID, h.Name)
}

// GenericContainer is a generic type (Go 1.18+).
type GenericContainer[T any] struct {
	items []T
}

// Add adds an item to the container.
func (c *GenericContainer[T]) Add(item T) {
	c.items = append(c.items, item)
}

// Get retrieves an item by index.
func (c *GenericContainer[T]) Get(index int) (T, bool) {
	if index < 0 || index >= len(c.items) {
		var zero T
		return zero, false
	}
	return c.items[index], true
}

// privateHelper is a private struct.
type privateHelper struct {
	value int
}

// doSomething is a private method on a private struct.
func (p *privateHelper) doSomething() int {
	return p.value * 2
}
