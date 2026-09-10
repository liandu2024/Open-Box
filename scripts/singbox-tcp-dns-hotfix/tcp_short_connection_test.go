package transport

import (
	"context"
	"errors"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	mDNS "github.com/miekg/dns"
)

// Model the observed path: a TCP connection initially works, but an idle
// connection subsequently accepts writes without replying or reporting EOF.
func TestOpenBoxTCPDNSAfterSilentIdle(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var accepted, closed atomic.Int32
	var connections sync.Map
	defer func() {
		listener.Close()
		connections.Range(func(key, _ any) bool { key.(net.Conn).Close(); return true })
	}()
	go func() {
		for {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			accepted.Add(1)
			connections.Store(conn, true)
			go func() {
				defer conn.Close()
				defer closed.Add(1)
				defer connections.Delete(conn)
				var last time.Time
				for {
					request, readErr := ReadMessage(conn)
					if readErr != nil {
						return
					}
					if !last.IsZero() && time.Since(last) > 100*time.Millisecond {
						continue
					}
					last = time.Now()
					response := new(mDNS.Msg)
					response.SetReply(request)
					if request.Question[0].Name == "missing.example." {
						response.Rcode = mDNS.RcodeNameError
					}
					if WriteMessage(conn, request.Id, response) != nil {
						return
					}
				}
			}()
		}
	}()
	transport := newTestTCPTransport(t, listener)
	defer transport.Close()
	for i, qType := range []uint16{mDNS.TypeA, mDNS.TypeAAAA, mDNS.TypeHTTPS} {
		if i == 1 {
			time.Sleep(40 * time.Millisecond)
		} else if i == 2 {
			time.Sleep(200 * time.Millisecond)
		}
		message := new(mDNS.Msg)
		name, wantRcode := "example.", mDNS.RcodeSuccess
		if i == 1 {
			name, wantRcode = "missing.example.", mDNS.RcodeNameError
		}
		message.SetQuestion(name, qType)
		message.Id = uint16(45000 + i)
		ctx, cancel := context.WithTimeout(context.Background(), 400*time.Millisecond)
		var response *mDNS.Msg
		if i == 2 {
			done := make(chan struct{})
			transport.ExchangeAsync(ctx, message, func(result *mDNS.Msg, queryErr error) {
				response, err = result, queryErr
				close(done)
			})
			<-done
		} else {
			response, err = transport.Exchange(ctx, message)
		}
		cancel()
		if err != nil {
			t.Fatalf("query %d after idle: %v", i, err)
		}
		if response.Id != message.Id || response.Rcode != wantRcode || response.Question[0] != message.Question[0] {
			t.Fatalf("query %d changed DNS semantics: %+v", i, response)
		}
	}
	deadline := time.Now().Add(time.Second)
	for closed.Load() < accepted.Load() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if accepted.Load() != 3 || closed.Load() != 3 {
		t.Fatalf("expected exactly three query connections, all closed; accepted=%d closed=%d", accepted.Load(), closed.Load())
	}
}

func TestOpenBoxTCPDNSCancellationClosesConnection(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	closed := make(chan struct{})
	go func() {
		conn, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		defer conn.Close()
		defer close(closed)
		ReadMessage(conn)
		var b [1]byte
		conn.SetReadDeadline(time.Now().Add(time.Second))
		conn.Read(b[:])
	}()
	transport := newTestTCPTransport(t, listener)
	defer transport.Close()
	message := new(mDNS.Msg)
	message.SetQuestion("timeout.example.", mDNS.TypeA)
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()
	_, err = transport.Exchange(ctx, message)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected cancellation, got %v", err)
	}
	select {
	case <-closed:
	case <-time.After(300 * time.Millisecond):
		t.Fatal("cancelled TCP DNS connection was not closed")
	}
}
