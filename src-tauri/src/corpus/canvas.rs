//! Canvases over the sidecar: reviewing one, and writing one.
//!
//! A `.canvas` file is JSONCanvas 1.0 — the same format the app's own canvas
//! views read (`src/canvas/jsoncanvas.ts`), and the reason a canvas is a note
//! like any other here: the note-type registry claims the extension, so ids,
//! grants and the walks all already work on it.
//!
//! Two shapes, because reviewing and authoring want opposite things.
//! [`summarize`] answers *what is on this board* without the geometry noise or
//! the stroke point clouds, which is what makes a canvas reviewable inside a
//! context window at all — a hand-drawn one can carry tens of thousands of
//! coordinates that mean nothing to a reader. [`validate`] is the authoring
//! half: a canvas an agent writes has to open in the app, so a dangling edge or
//! a duplicate id is refused here rather than discovered as a broken board.
//!
//! Everything not modeled rides through untouched, because the file is
//! `serde_json::Value` from end to end — other tools write these files, and a
//! round trip must never shed their data.

use serde::Serialize;
use serde_json::Value;

/// Node types the spec defines, plus this app's documented `ink` extension —
/// freehand strokes, which the spec's axis-aligned rectangles can't carry. An
/// unknown type is *not* an error: a conforming reader skips what it doesn't
/// know, and refusing would make this tool the one thing that can't round-trip
/// a foreign file.
pub const KNOWN_TYPES: [&str; 5] = ["text", "file", "link", "group", "ink"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeSummary {
    pub id: String,
    pub node_type: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Text nodes: their markdown. File nodes: the path. Link nodes: the URL.
    /// Group nodes: the label. One field, because a reader wants "what does
    /// this box say" and the type already tells it which kind of answer it is.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Ink nodes: how many strokes, never the points. The points are the whole
    /// reason a canvas can't just be read as JSON.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strokes: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeSummary {
    pub id: String,
    pub from_node: String,
    pub to_node: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub nodes: Vec<NodeSummary>,
    pub edges: Vec<EdgeSummary>,
    /// Top-level keys this format doesn't define, named so a caller knows the
    /// file carries something it isn't being shown.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub extra_keys: Vec<String>,
}

fn num(v: Option<&Value>) -> f64 {
    v.and_then(Value::as_f64).unwrap_or(0.0)
}

fn text(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str).map(str::to_string)
}

pub fn parse(source: &str) -> Result<Value, String> {
    // An empty file is an empty canvas: the app writes one that way, and
    // refusing it would make "add to my canvas" fail on a fresh board.
    if source.trim().is_empty() {
        return Ok(empty());
    }
    let doc: Value = serde_json::from_str(source).map_err(|e| format!("not valid JSON: {e}"))?;
    if !doc.is_object() {
        return Err("a canvas file has to be a JSON object".into());
    }
    Ok(doc)
}

pub fn empty() -> Value {
    serde_json::json!({ "nodes": [], "edges": [] })
}

fn array<'a>(doc: &'a Value, key: &str) -> &'a [Value] {
    doc.get(key).and_then(Value::as_array).map_or(&[], |v| v)
}

/// What is on this board, without the geometry noise or the stroke points.
pub fn summarize(doc: &Value) -> Summary {
    let nodes = array(doc, "nodes")
        .iter()
        .filter_map(|n| {
            let node_type = text(n.get("type")).unwrap_or_default();
            let content = match node_type.as_str() {
                "text" => text(n.get("text")),
                "file" => text(n.get("file")),
                "link" => text(n.get("url")),
                "group" => text(n.get("label")),
                _ => None,
            };
            Some(NodeSummary {
                id: text(n.get("id"))?,
                content,
                color: text(n.get("color")),
                strokes: n
                    .get("strokes")
                    .and_then(Value::as_array)
                    .map(|s| s.len())
                    .filter(|_| node_type == "ink"),
                node_type,
                x: num(n.get("x")),
                y: num(n.get("y")),
                width: num(n.get("width")),
                height: num(n.get("height")),
            })
        })
        .collect();
    let edges = array(doc, "edges")
        .iter()
        .filter_map(|e| {
            Some(EdgeSummary {
                id: text(e.get("id"))?,
                from_node: text(e.get("fromNode"))?,
                to_node: text(e.get("toNode"))?,
                label: text(e.get("label")),
                color: text(e.get("color")),
            })
        })
        .collect();
    let extra_keys = doc
        .as_object()
        .map(|o| {
            o.keys()
                .filter(|k| *k != "nodes" && *k != "edges")
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    Summary {
        nodes,
        edges,
        extra_keys,
    }
}

/// Every way this document would fail to open as a board, collected — a caller
/// fixing three problems should need one round trip, not three.
///
/// What is checked is what breaks the app or loses data: identity (present,
/// unique), the rectangle every node needs to be placed, and edges pointing at
/// nodes that exist. What is deliberately *not* checked: unknown node types,
/// unknown fields, colors outside the preset range — all of which a foreign
/// file may legitimately carry.
pub fn validate(doc: &Value) -> Result<(), Vec<String>> {
    let mut problems = Vec::new();
    if !doc.is_object() {
        return Err(vec!["a canvas has to be a JSON object".into()]);
    }
    for key in ["nodes", "edges"] {
        if let Some(v) = doc.get(key) {
            if !v.is_array() {
                problems.push(format!("\"{key}\" has to be an array"));
            }
        }
    }
    if !problems.is_empty() {
        return Err(problems);
    }

    let mut ids: Vec<&str> = Vec::new();
    for (i, node) in array(doc, "nodes").iter().enumerate() {
        let at = format!("node {i}");
        if !node.is_object() {
            problems.push(format!("{at} is not an object"));
            continue;
        }
        match node.get("id").and_then(Value::as_str) {
            Some(id) if !id.is_empty() => {
                if ids.contains(&id) {
                    problems.push(format!("{at}: duplicate id \"{id}\""));
                }
                ids.push(id);
            }
            _ => problems.push(format!("{at} has no \"id\"")),
        }
        match node.get("type").and_then(Value::as_str) {
            Some(t) if !t.is_empty() => {
                // Content a node of a known type needs to mean anything.
                let needs = match t {
                    "text" => Some("text"),
                    "file" => Some("file"),
                    "link" => Some("url"),
                    _ => None,
                };
                if let Some(field) = needs {
                    if node.get(field).and_then(Value::as_str).is_none() {
                        problems.push(format!("{at} is a \"{t}\" node with no \"{field}\""));
                    }
                }
            }
            _ => problems.push(format!("{at} has no \"type\"")),
        }
        for field in ["x", "y", "width", "height"] {
            if node.get(field).and_then(Value::as_f64).is_none() {
                problems.push(format!("{at} has no numeric \"{field}\""));
            }
        }
    }

    let mut edge_ids: Vec<&str> = Vec::new();
    for (i, edge) in array(doc, "edges").iter().enumerate() {
        let at = format!("edge {i}");
        if !edge.is_object() {
            problems.push(format!("{at} is not an object"));
            continue;
        }
        match edge.get("id").and_then(Value::as_str) {
            Some(id) if !id.is_empty() => {
                if edge_ids.contains(&id) {
                    problems.push(format!("{at}: duplicate id \"{id}\""));
                }
                edge_ids.push(id);
            }
            _ => problems.push(format!("{at} has no \"id\"")),
        }
        for field in ["fromNode", "toNode"] {
            match edge.get(field).and_then(Value::as_str) {
                // A dangling edge is the one error worth naming precisely: it
                // is what an agent gets wrong when it writes nodes and edges in
                // the same call and mistypes one id.
                Some(target) => {
                    if !ids.contains(&target) {
                        problems.push(format!("{at}: \"{field}\" points at \"{target}\", which is not a node on this canvas"));
                    }
                }
                None => problems.push(format!("{at} has no \"{field}\"")),
            }
        }
    }

    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems)
    }
}

/// Serialize a canvas the way the app writes one: pretty-printed, so the file
/// stays reviewable in a diff and in any other editor.
pub fn to_text(doc: &Value) -> Result<String, String> {
    let mut out = serde_json::to_string_pretty(doc).map_err(|e| e.to_string())?;
    out.push('\n');
    Ok(out)
}
