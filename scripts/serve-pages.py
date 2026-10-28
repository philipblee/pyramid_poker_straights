"""Serve this project over HTTP.

Python's stock http.server copies a file to the socket in 1 MB pieces.
On Windows a single piece that large can block after about 914 KB, and the
browser then reports a 200 followed by ERR_CONNECTION_RESET. The empirical
lookup is the file that crosses that size. Copying 64 KB at a time avoids it.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import shutil


class Handler(SimpleHTTPRequestHandler):
    def copyfile(self, source, outputfile):
        shutil.copyfileobj(source, outputfile, length=64 * 1024)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8766), Handler)
    print("Serving http://127.0.0.1:8766/game.html", flush=True)
    server.serve_forever()
