use serde_json::Value;
use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    time::Duration,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HttpProbeError {
    Connect,
    Write,
    Read,
    InvalidStatus,
    InvalidHeaders,
    InvalidChunk,
    InvalidJson,
}

pub fn get_json_http_11(host: &str, port: u16, path: &str, timeout: Duration) -> Result<Value, HttpProbeError> {
    let address: SocketAddr = format!("{host}:{port}")
        .parse()
        .map_err(|_| HttpProbeError::Connect)?;
    let mut stream = TcpStream::connect_timeout(&address, timeout).map_err(|_| HttpProbeError::Connect)?;
    let _ = stream.set_read_timeout(Some(timeout));

    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).map_err(|_| HttpProbeError::Write)?;

    let mut response = Vec::new();
    stream.read_to_end(&mut response).map_err(|_| HttpProbeError::Read)?;

    let (headers, body) = split_response(&response)?;
    if !headers.starts_with("HTTP/1.1 200") && !headers.starts_with("HTTP/1.0 200") {
        return Err(HttpProbeError::InvalidStatus);
    }

    let decoded = if has_chunked_transfer_encoding(headers) {
        decode_chunked(body)?
    } else {
        body.to_vec()
    };

    serde_json::from_slice(&decoded).map_err(|_| HttpProbeError::InvalidJson)
}

fn split_response(response: &[u8]) -> Result<(&str, &[u8]), HttpProbeError> {
    let marker = b"\r\n\r\n";
    let index = response
        .windows(marker.len())
        .position(|window| window == marker)
        .ok_or(HttpProbeError::InvalidHeaders)?;
    let headers = std::str::from_utf8(&response[..index]).map_err(|_| HttpProbeError::InvalidHeaders)?;
    Ok((headers, &response[index + marker.len()..]))
}

fn has_chunked_transfer_encoding(headers: &str) -> bool {
    headers.lines().any(|line| {
        let Some((name, value)) = line.split_once(':') else {
            return false;
        };
        name.trim().eq_ignore_ascii_case("transfer-encoding")
            && value
                .split(',')
                .any(|encoding| encoding.trim().eq_ignore_ascii_case("chunked"))
    })
}

fn decode_chunked(body: &[u8]) -> Result<Vec<u8>, HttpProbeError> {
    let mut output = Vec::new();
    let mut cursor = 0usize;

    loop {
        let line_end = find_crlf(body, cursor).ok_or(HttpProbeError::InvalidChunk)?;
        let size_line = std::str::from_utf8(&body[cursor..line_end]).map_err(|_| HttpProbeError::InvalidChunk)?;
        let size_text = size_line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_text, 16).map_err(|_| HttpProbeError::InvalidChunk)?;
        cursor = line_end + 2;

        if size == 0 {
            return Ok(output);
        }

        let end = cursor.checked_add(size).ok_or(HttpProbeError::InvalidChunk)?;
        if end + 2 > body.len() {
            return Err(HttpProbeError::InvalidChunk);
        }

        output.extend_from_slice(&body[cursor..end]);

        if &body[end..end + 2] != b"\r\n" {
            return Err(HttpProbeError::InvalidChunk);
        }

        cursor = end + 2;
    }
}

fn find_crlf(body: &[u8], start: usize) -> Option<usize> {
    body[start..]
        .windows(2)
        .position(|window| window == b"\r\n")
        .map(|offset| start + offset)
}

#[cfg(test)]
mod tests {
    use super::{decode_chunked, get_json_http_11, has_chunked_transfer_encoding, split_response};
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
        time::Duration,
    };

    #[test]
    fn get_json_http_11_decodes_chunked_response_from_server() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let port = listener.local_addr().expect("local addr").port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept probe");
            let mut request = [0; 512];
            let _ = stream.read(&mut request).expect("read request");
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\nb\r\n{\"ok\":true}\r\n0\r\n\r\n")
                .expect("write chunked response");
        });

        let value = get_json_http_11("127.0.0.1", port, "/health", Duration::from_secs(1)).expect("probe json");
        handle.join().expect("server thread");

        assert_eq!(value.get("ok").and_then(|value| value.as_bool()), Some(true));
    }

    #[test]
    fn decodes_chunked_json_body() {
        let body = b"7\r\n{\"ok\":t\r\n4\r\nrue}\r\n0\r\n\r\n";
        assert_eq!(decode_chunked(body).unwrap(), br#"{"ok":true}"#);
    }

    #[test]
    fn supports_chunk_extensions() {
        let body = b"7;part=1\r\n{\"ok\":t\r\n4\r\nrue}\r\n0\r\n\r\n";
        assert_eq!(decode_chunked(body).unwrap(), br#"{"ok":true}"#);
    }

    #[test]
    fn splits_http_response_headers_and_body() {
        let response = b"HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n0\r\n\r\n";
        let (headers, body) = split_response(response).unwrap();
        assert!(headers.contains("HTTP/1.1 200"));
        assert_eq!(body, b"0\r\n\r\n");
    }

    #[test]
    fn detects_chunked_transfer_encoding_case_insensitively() {
        let headers = "HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip, Chunked";
        assert!(has_chunked_transfer_encoding(headers));
    }
}
