"""The word brief: short meaning and origin read out of Abbott-Smith-style lexicon entries."""

from testimonia.server.brief import fold, parse_entry

MONOGENES = (
    "μονογενής , -ές (μόνος, γένος), [in LXX: Jdg.11:34 , Psa.22:20 25:16 35:17 (יָחִיד), Tob.3:15 6:10, 14 8:17 , "
    "Wis.7:22 , Bar.4:16 * ;] only, only begotten ( DCG , ii, 281), of sons and daughters : Luk.7:12"
)
HOUTOS_ADV = (
    "οὕτως , rarely (Bl., §5, 4; WH, App. , 146f.) οὕτω, adv. (οὗτος), [in LXX chiefly for כֵּן ;] in this way, so, "
    "thus ; __1. referring to what precedes : Mat.5:16"
)
AGAPAO = (
    "ἀγαπάω , -ῶ, [in LXX chiefly for אהב ;] to love , to feel and exhibit esteem and goodwill to a person, to prize "
    "and delight in a thing. __1. Of human affection"
)
HOUTOS = (
    "οὗτος , αὕτη, τοῦτο, genitive, τούτου, ταύτης, τούτου, [in LXX chiefly for זֹאת ,זֶה ;] demonstr. pron. "
    "(related to ἐκεῖνος as hic to ille), this ; __1. as subst."
)
ARTICLE = (
    "ὁ , ἡ, τό, the prepositive article (ἄρθρον προτακτικόν), originally a demonstr. pron. (so usually in Hom.), "
    "in general corresponding to the Eng. definite article. __I. As demonstr. pron."
)
CUT_OFF = "θεός , -οῦ, ὁ, ἡ ( Act.19:37 only), [in LXX chiefly for אֱלֹהִים ;] a god or de"


def test_meaning_and_origin():
    assert parse_entry(MONOGENES) == ("only, only begotten", ["μόνος", "γένος"])


def test_origin_after_a_note_in_brackets():
    assert parse_entry(HOUTOS_ADV) == ("in this way, so, thus", ["οὗτος"])


def test_long_meaning_keeps_the_first_sense():
    assert parse_entry(AGAPAO) == ("to love", [])


def test_grammar_is_not_a_meaning():
    assert parse_entry(HOUTOS)[0] is None


def test_a_term_in_brackets_is_not_an_origin():
    assert parse_entry(ARTICLE) == (None, [])


def test_cut_off_entry_gives_no_meaning():
    assert parse_entry(CUT_OFF)[0] is None


def test_fold_ignores_accents_and_final_sigma():
    assert fold("Οὗτος") == fold("ουτοσ") == "ουτοσ"
