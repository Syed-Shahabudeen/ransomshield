from http.server import BaseHTTPRequestHandler, HTTPServer

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        length = self.headers.get('Content-Length')
        try:
            n = int(length) if length else 0
        except ValueError:
            n = 0
        body = self.rfile.read(n) if n else b'<NO CONTENT-LENGTH>'
        print('=== REQUEST ===', flush=True)
        print('path:', self.path, flush=True)
        for k, v in self.headers.items():
            print(f'  {k}: {v}', flush=True)
        print('body:', body[:400], flush=True)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"ok":true}')
    def log_message(self, *a):
        pass

print('dump server on :9999', flush=True)
HTTPServer(('127.0.0.1', 9999), H).serve_forever()
