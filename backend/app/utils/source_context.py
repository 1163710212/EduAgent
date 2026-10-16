def source_context(content: str, question: dict, limit: int = 12000) -> str:
    """Keep the actual target in model context, even near the end of a large file."""
    if len(content) <= limit:
        return content
    target = question.get("answer_key", {})
    start = max(0, int(target.get("start_line", 1)) - 12)
    end = int(target.get("end_line", start + 1)) + 16
    lines = content.splitlines()
    focus = "\n".join(lines[start:end])
    return (
        "[File beginning]\n" + content[:2000]
        + f"\n[Target context, starting near line {start + 1}]\n"
        + focus[:limit - 2200]
    )
