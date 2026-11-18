"""Choose a repository's dominant programming language from GitHub byte counts."""
from pathlib import PurePosixPath

from app.services.language_catalog import LANGUAGE_TYPES


# Source formats supported by the existing explanation/completion pipeline.
# Keep JS and TS separate; ambiguous .h headers are not used as question targets.
SOURCE_LANGUAGES = {
    "Python": ("python", (".py", ".pyw")),
    "JavaScript": ("javascript", (".js", ".jsx", ".mjs", ".cjs")),
    "TypeScript": ("typescript", (".ts", ".tsx", ".mts", ".cts")),
    "Java": ("java", (".java",)),
    "Go": ("go", (".go",)),
    "C": ("c", (".c",)),
    "C++": ("cpp", (".cpp", ".cc", ".cxx", ".c++", ".cp", ".cppm", ".ixx", ".hpp", ".hh", ".hxx")),
}


class LanguageSelectionError(ValueError):
    """Valid repository statistics that cannot yield a supported challenge."""


def validate_language_bytes(data: object) -> dict[str, int]:
    if not isinstance(data, dict) or any(
        not isinstance(name, str) or not name.strip()
        or type(size) is not int or size < 0
        for name, size in data.items()
    ):
        raise ValueError("Invalid GitHub language byte counts.")
    return dict(data)


def select_dominant_language(data: object) -> dict:
    counts = validate_language_bytes(data)
    positive = {name: size for name, size in counts.items() if size > 0}
    unknown = sorted(set(positive) - LANGUAGE_TYPES.keys())
    if unknown:
        raise ValueError(f"Unrecognized GitHub language classification: {', '.join(unknown)}. Update the language catalog.")
    programming = {name: size for name, size in positive.items() if LANGUAGE_TYPES[name] == "programming"}
    if not programming:
        raise LanguageSelectionError("No programming languages found in GitHub repository language statistics.")

    # Stable ties do not depend on JSON key order or on whether a language is supported.
    name = min(programming, key=lambda key: (-programming[key], key.casefold(), key))
    if name not in SOURCE_LANGUAGES:
        raise LanguageSelectionError(
            f"Dominant programming language '{name}' is not supported for question generation. "
            f"Supported languages: {', '.join(SOURCE_LANGUAGES)}. No other language was substituted."
        )
    total = sum(positive.values())
    return {
        "strategy": "largest_programming_language",
        "source": "github_languages_api",
        "scope": "repository_default_branch",
        "language": SOURCE_LANGUAGES[name][0],
        "github_language": name,
        "bytes": programming[name],
        "total_bytes": total,
        "share_percent": round(programming[name] / total * 100, 2),
        "language_bytes": counts,
        "tie_break": "alphabetical",
    }


def language_extensions(language: str) -> tuple[str, ...]:
    for key, extensions in SOURCE_LANGUAGES.values():
        if key == language.lower():
            return extensions
    raise ValueError(f"Unsupported source language: {language}")


def matches_language(path: str, language: str) -> bool:
    # On case-sensitive repositories, .C is C++, whereas .c is C.
    if PurePosixPath(path).suffix == ".C":
        return language == "cpp"
    return path.lower().endswith(language_extensions(language))


def search_language(language: str) -> str:
    return next(name for name, (key, _) in SOURCE_LANGUAGES.items() if key == language)
