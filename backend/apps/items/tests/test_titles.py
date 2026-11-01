from apps.items.titles import note_title


def test_the_first_h1_names_the_note():
    assert note_title("Some intro\n\n# **Trip** plan\nmore\n# Other") == "Trip plan"


def test_headings_inside_code_don_t_count():
    body = "Setup\n```sh\n# install it\n```\n# Real title"
    assert note_title(body) == "Real title"


def test_without_an_h1_it_is_the_first_line_as_plain_words():
    assert note_title("\n\n## *Trip* plan\nmore") == "Trip plan"
    assert note_title("> - [x] Read [the docs](https://example.com) `now`") == (
        "Read the docs now"
    )
    assert note_title("1. ==First== step") == "First step"


def test_falls_back_when_there_are_no_words():
    assert note_title("") == "Note"
    assert note_title("#  ", fallback="") == ""


def test_stays_short():
    assert len(note_title("a" * 200)) == 80
