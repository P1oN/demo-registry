package main

import (
	"compress/gzip"
	"flag"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"path/filepath"
	"strings"
)

type gzipResponseWriter struct {
	http.ResponseWriter
	w io.Writer
}

func (g gzipResponseWriter) Write(b []byte) (int, error) { return g.w.Write(b) }

func withGzip(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}

		ext := strings.ToLower(filepath.Ext(r.URL.Path))
		if ext != ".tsv" && ext != ".html" && ext != ".js" && ext != ".css" {
			next.ServeHTTP(w, r)
			return
		}

		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")

		gz, err := gzip.NewWriterLevel(w, gzip.BestCompression)
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}
		defer gz.Close()

		next.ServeHTTP(gzipResponseWriter{ResponseWriter: w, w: gz}, r)
	})
}

func main() {
	var dir string
	var addr string
	flag.StringVar(&dir, "dir", "../dist", "directory to serve")
	flag.StringVar(&addr, "addr", "127.0.0.1:8787", "listen address")
	flag.Parse()

	_ = mime.AddExtensionType(".tsv", "text/tab-separated-values; charset=utf-8")

	fs := http.FileServer(http.Dir(dir))

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")

		// Cache hints
		if strings.HasPrefix(r.URL.Path, "/registry.") && strings.HasSuffix(r.URL.Path, ".tsv") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else if r.URL.Path == "/registry.tsv" {
			w.Header().Set("Cache-Control", "public, max-age=60")
		}

		fs.ServeHTTP(w, r)
	})

	fmt.Printf("Serving %s at http://%s\n", dir, addr)
	log.Fatal(http.ListenAndServe(addr, withGzip(handler)))
}
