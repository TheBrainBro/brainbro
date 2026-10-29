from apps.exports.names import Folder, clean


def test_clean_keeps_the_title_and_drops_what_file_systems_refuse():
    assert clean("Ideas: what/why?") == "Ideas what why"
    assert clean("  Café\tnotes \n") == "Café notes"
    assert clean("...hidden. ") == "hidden"
    assert clean("con") == "con_"
    assert clean("") == "Untitled"
    assert clean("***", fallback="Board") == "Board"
    assert len(clean("x" * 300)) == 100


def test_folder_numbers_clashes_ignoring_case():
    folder = Folder()
    assert folder.name("Ideas", "md") == "Ideas.md"
    assert folder.name("ideas", "md") == "ideas 2.md"
    assert folder.name("Ideas", "md") == "Ideas 3.md"
    assert folder.name("Ideas", "json") == "Ideas.json"
    assert folder.name("Ideas") == "Ideas"
