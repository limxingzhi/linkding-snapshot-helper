function sanitize(title) {
  let safe = title.trim().replace(/[<>:"/\\|?*]/g, "");
  safe = safe.replace(/\s+/g, " ");
  safe = safe.trim().replace(/^[.\s]+|[.\s]+$/g, "");
  safe = safe.slice(0, 200);
  return safe || "untitled";
}

module.exports = { sanitize };
