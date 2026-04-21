from io import BytesIO
from zipfile import ZipFile

from app.ingestion import extract_submission_archives, is_relevant_java_file


def make_zip(entries: dict[str, bytes]) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as zf:
        for name, payload in entries.items():
            zf.writestr(name, payload)
    return buffer.getvalue()


def test_extract_submission_archives_only_reads_zip_entries() -> None:
    submission_zip = make_zip({"src/Main.java": b"class Main {}"})
    bundle_zip = make_zip(
        {
            "student1.zip": submission_zip,
            "archivelist.csv": b"ignore",
            "notes.txt": b"ignore",
        }
    )
    found = extract_submission_archives(bundle_zip)
    assert len(found) == 1
    assert found[0][0] == "student1"


def test_is_relevant_java_file_filters_hidden_and_underscore() -> None:
    assert is_relevant_java_file("src/Main.java")
    assert not is_relevant_java_file("src/_Main.java")
    assert not is_relevant_java_file("src/.Hidden.java")
    assert not is_relevant_java_file("__MACOSX/Main.java")
