// Package imports demonstrates various Go import patterns.
package imports

import "fmt"

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// Aliased imports
import (
	ctx "context"
	. "math"
	_ "database/sql/driver"
)

// Import with custom alias
import myio "io/ioutil"

// UseImports demonstrates using various imported packages.
func UseImports() {
	// Standard import
	fmt.Println("Hello")

	// Grouped import
	data, _ := json.Marshal(map[string]string{"key": "value"})
	fmt.Println(string(data))

	// Aliased import
	background := ctx.Background()
	_ = background

	// Dot import (math functions available directly)
	result := Sqrt(16)
	fmt.Printf("Square root: %f\n", result)

	// Another aliased import
	content, _ := myio.ReadAll(strings.NewReader("test"))
	_ = content
}

// MakeRequest demonstrates net/http usage.
func MakeRequest(url string) (*http.Response, error) {
	return http.Get(url)
}

// CopyData demonstrates io usage.
func CopyData(dst io.Writer, src io.Reader) (int64, error) {
	return io.Copy(dst, src)
}
