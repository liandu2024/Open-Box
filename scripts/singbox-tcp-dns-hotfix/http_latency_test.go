package urltest

import (
	"context"
	"crypto/x509"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/sagernet/sing-box/adapter"
	M "github.com/sagernet/sing/common/metadata"
	"github.com/sagernet/sing/service"
)

// Redirect only the socket in this fixture, so HTTP Host/path and the requested
// destination still expose an unexpected protocol or fallback URL.
type openBoxHTTPDialer struct {
	address     string
	mu          sync.Mutex
	destination M.Socksaddr
}

func (d *openBoxHTTPDialer) DialContext(ctx context.Context, network string, destination M.Socksaddr) (net.Conn, error) {
	d.mu.Lock()
	d.destination = destination
	d.mu.Unlock()
	return (&net.Dialer{}).DialContext(ctx, network, d.address)
}

func (*openBoxHTTPDialer) ListenPacket(context.Context, M.Socksaddr) (net.PacketConn, error) {
	return nil, errors.New("unexpected UDP probe")
}

type openBoxHTTPCertificates struct {
	adapter.CertificateStore
	pool *x509.CertPool
}

func (c openBoxHTTPCertificates) Pool() *x509.CertPool { return c.pool }

func TestOpenBoxHTTPProbe(t *testing.T) {
	for _, secure := range []bool{false, true} {
		t.Run(map[bool]string{false: "HTTP", true: "HTTPS"}[secure], func(t *testing.T) {
			requests := make(chan *http.Request, 1)
			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests <- r
				w.WriteHeader(http.StatusNoContent)
			})
			var server *httptest.Server
			ctx := context.Background()
			if secure {
				server = httptest.NewTLSServer(handler)
				pool := x509.NewCertPool()
				pool.AddCert(server.Certificate())
				ctx = service.ContextWith[adapter.CertificateStore](ctx, openBoxHTTPCertificates{pool: pool})
			} else {
				server = httptest.NewServer(handler)
			}
			defer server.Close()
			dialer := &openBoxHTTPDialer{address: server.Listener.Addr().String()}
			delay, err := URLTest(ctx, server.URL+"/custom-204?source=clash", dialer)
			if err != nil || delay == 0 {
				t.Fatalf("successful probe: delay=%d err=%v", delay, err)
			}
			request := <-requests
			if request.Method != http.MethodHead || request.URL.RequestURI() != "/custom-204?source=clash" {
				t.Fatalf("unexpected request: %s %s", request.Method, request.URL)
			}
		})
	}
}

func TestOpenBoxHTTPDefaultAndRedirect(t *testing.T) {
	requests := make(chan *http.Request, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r
		w.Header().Set("Location", "https://must-not-follow.invalid/")
		w.WriteHeader(http.StatusFound)
	}))
	defer server.Close()
	dialer := &openBoxHTTPDialer{address: server.Listener.Addr().String()}
	delay, err := URLTest(context.Background(), "", dialer)
	if err != nil || delay == 0 {
		t.Fatalf("default HTTP probe: delay=%d err=%v", delay, err)
	}
	request := <-requests
	if request.Host != "www.gstatic.com" || request.URL.Path != "/generate_204" || dialer.destination.Port != 80 {
		t.Fatalf("wrong default: host=%s path=%s destination=%s", request.Host, request.URL.Path, dialer.destination)
	}
	if len(requests) != 0 {
		t.Fatal("probe followed redirect")
	}
}

func TestOpenBoxHTTPTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	delay, err := URLTest(ctx, server.URL, &openBoxHTTPDialer{address: server.Listener.Addr().String()})
	if err == nil || delay != 0 {
		t.Fatalf("timeout: delay=%d err=%v", delay, err)
	}
}
