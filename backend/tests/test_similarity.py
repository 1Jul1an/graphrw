from app.analysis import _build_comparison_model, _hybrid_similarity


def test_hybrid_similarity_rewards_sparse_shared_signals() -> None:
    raw = {
        "sub_a": {"import_family:java.util": 1.0, "collection_usage": 4.0, "file_count": 1.0},
        "sub_b": {"import_family:java.util": 1.0, "collection_usage": 5.0, "file_count": 1.0},
        "sub_c": {"import_family:java.io": 1.0, "io_usage": 4.0, "file_count": 1.0},
    }
    model = _build_comparison_model(raw, "sem")

    score_ab, _ = _hybrid_similarity(
        left_weighted=model["weighted"]["sub_a"],
        right_weighted=model["weighted"]["sub_b"],
        left_standardized=model["standardized"]["sub_a"],
        right_standardized=model["standardized"]["sub_b"],
        space="sem",
    )
    score_ac, _ = _hybrid_similarity(
        left_weighted=model["weighted"]["sub_a"],
        right_weighted=model["weighted"]["sub_c"],
        left_standardized=model["standardized"]["sub_a"],
        right_standardized=model["standardized"]["sub_c"],
        space="sem",
    )

    assert score_ab > score_ac
