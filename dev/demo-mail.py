"""Demo mailboxes for the README screenshots: Jessica Jones's inbox (fictional, Marvel easter eggs).

Usage: python3 -I dev/demo-mail.py PROFILE_MAIL_FOLDER
Writes Inbox and Sent (mbox) in the given "Local Folders" directory. Called by dev/make-test-profile.sh when HERON_DEMO=1.
"""

import email.utils
import sys
from datetime import datetime, timedelta, timezone
from email.header import Header
from pathlib import Path

FOLDER = Path(sys.argv[1])
ME = ("Jessica Jones", "jess@thedefenders.we")
NOW = datetime(2026, 10, 22, 10, 30, tzinfo=timezone(timedelta(hours=-4)))


def address(name, mail):
    return email.utils.formataddr((str(Header(name, "utf-8")) if not name.isascii() else name, mail))


def message(sender, subject, body, when, *, to=ME, cc=(), msgid, refs=(), unread=False, flagged=False, html=False, attachment=None):
    status = 0 if unread else 1
    if flagged:
        status |= 4
    headers = [
        f"From - {when.strftime('%a %b %d %H:%M:%S %Y')}",
        f"X-Mozilla-Status: {status:04x}",
        "X-Mozilla-Status2: 00000000",
        f"From: {address(*sender)}",
        f"To: {address(*to)}",
    ]
    if cc:
        headers.append("Cc: " + ", ".join(address(*c) for c in cc))
    headers += [
        f"Subject: {Header(subject, 'utf-8').encode() if not subject.isascii() else subject}",
        f"Date: {email.utils.format_datetime(when)}",
        f"Message-ID: <{msgid}@demo.heron>",
    ]
    if refs:
        headers.append(f"In-Reply-To: <{refs[-1]}@demo.heron>")
        headers.append("References: " + " ".join(f"<{r}@demo.heron>" for r in refs))
    headers.append("MIME-Version: 1.0")
    kind = "html" if html else "plain"
    if attachment:
        headers.append('Content-Type: multipart/mixed; boundary="demo-sep"')
        part = f"--demo-sep\nContent-Type: text/{kind}; charset=UTF-8\nContent-Transfer-Encoding: 8bit\n\n{body}\n\n"
        part += f'--demo-sep\nContent-Type: application/pdf; name="{attachment}"\nContent-Disposition: attachment; filename="{attachment}"\nContent-Transfer-Encoding: base64\n\nJVBERi0xLjQKJcTl8uXrCg==\n--demo-sep--\n'
        return "\n".join(headers) + "\n\n" + part + "\n"
    headers += [f"Content-Type: text/{kind}; charset=UTF-8", "Content-Transfer-Encoding: 8bit"]
    return "\n".join(headers) + "\n\n" + body + "\n\n"


def ago(days=0, hours=0, minutes=0):
    return NOW - timedelta(days=days, hours=hours, minutes=minutes)


CAROL = ("Carol Danvers", "carol@higherfurtherfaster.space")
TRISH = ("Trish Walker", "trish@trishtalk.fm")
NEBULA = ("Nebula", "nebula@guardians.gal")
ROCKET = ("Rocket", "rocket@guardians.gal")
GYM = "Group rates at the gym"
MATT = ("Matt Murdock", "matt@nelsonandmurdock.law")
LUKE = ("Luke Cage", "luke@harlemsparadise.com")
DANNY = ("Danny Rand", "danny@randenterprises.com")
STAKEOUT = "Rooftop stakeout, Hell's Kitchen"

inbox = [
    # A form letter sent to every superhero he could find: he even left the placeholder in.
    message(("Red Guardian", "redguardian@avengerz.com"), "Team-up proposal",
            "Hello new Avengerz,\n\n"
            "I have a proposal: Famous Red Guardian and famous [какой-то супергерой], together fighting crime. "
            "I bring shield (I made myself it's very round). Dont bring Yelena in loop, she is not ready yet for big league.\n\n"
            "Alexei",
            ago(minutes=25), msgid="redguardian-1", unread=True),
    message(LUKE, "Danielle's drawing",
            "Jess,\n\nDanielle drew you punching a bad guy. Through a wall. She says you're her favorite. I'm second.\n\nShe wants to give it to you Sunday. Pancakes at nine.\n\nLuke",
            ago(hours=1), msgid="luke-1", unread=True),
    message(TRISH, "You're on the show Thursday",
            "Jess,\n\nYou said \"maybe\", I heard \"yes\". Thursday, 9 a.m., no sunglasses on air.\n\nLove,\nPatsy (don't call me Patsy)",
            ago(hours=2), msgid="trish-1", unread=True),
    # Phishing easter egg: the display name is a Stark Industries address, the real sender is not.
    message(("pepper.potts@starkindustries.com", "billing@starklndustries.co"), "Your Stark Industries invoice is overdue",
            "Dear valued customer,\n\nYour Iron Legion subscription will be suspended in 24 hours. Click here to confirm your card details.\n\nStark Industries Billing",
            ago(hours=5), msgid="phish-1", unread=True),
    # Bruce's own campaign newsletter (green, as in Hulk).
    message(("Bruce Banner", "bruce@votebruce.org"), "Vote Bruce, Vote Green",
            "<html><body><h1>Vote Bruce, Vote Green</h1><p>Friends,</p><p>I'm running for the neighborhood council. "
            "My platform: more parks, more trees, quieter streets, and a promise to stay calm at every single meeting. Mostly.</p>"
            "<p>Let's smash apathy together (figuratively).</p>"
            "<p>Bruce Banner, PhD (seven of them)</p><p><small>You receive this because you once signed a petition in Harlem. Unsubscribe.</small></p>"
            '<img src="https://votebruce.us1.list-manage.com/track/open.php?u=hulk&id=green" width="1" height="1" alt="">'
            "</body></html>",
            ago(hours=7), msgid="banner-1", html=True),
    # Ant-Man's Substack.
    message(("Scott Lang from Starting Little", "startinglittle@substack.com"), "Starting Little: why size doesn't matter (mostly)",
            "<html><body><h1>Starting Little</h1><p>Hi friends,</p><p>New post: how I went from ex-con to Avenger, why you should always read the fine print on a quantum suit, "
            "and the one ant who never got credit. Spoiler: his name is Ant-thony.</p><p>Look out for the little guy,<br>Scott</p>"
            '<img src="https://substack.com/open/startinglittle.gif?post=12" width="1" height="1" alt="">'
            "</body></html>",
            ago(days=1, hours=2), msgid="antman-1", html=True),
    # The gym thread (Rocket's reply follows).
    message(CAROL, GYM,
            "Hi all,\n\nThe gym gives 20% off for a group of five, so I put us all on one plan: me, Jessica, Trish, Nebula and Rocket.\n\n"
            "Rules from the front desk: no flying indoors, no throwing the weights at the instructors (Nebula), and no modifications to the equipment (Rocket).\n\nCarol",
            ago(days=1, hours=5), to=ME, cc=(TRISH, NEBULA, ROCKET), msgid="gym-1"),
    message(ROCKET, f"Re: {GYM}",
            "Fine, I won't touch the equipment. Much.\n\nCan Groot come? He'll only say one thing at the front desk.\n\n"
            "On Wed, Oct 21, 2026 at 5:30 AM Carol Danvers wrote:\n> The gym gives 20% off for a group of five",
            ago(days=1, hours=3), to=CAROL, cc=(ME, TRISH, NEBULA), msgid="gym-2", refs=("gym-1",), unread=True),
    message(("Malcolm Ducasse", "malcolm@aliasinvestigations.nyc"), "Invoice for the Hogarth case",
            "Hey Jess,\n\nInvoice for last week attached. I itemized the coffee this time, so Hogarth can't say we made it up.\n\nMalcolm",
            ago(days=1, hours=1), msgid="malcolm-1", flagged=True, attachment="alias-investigations-invoice.pdf"),
    message(("The Daily Bugle", "newsletter@dailybugle.net"), "Spider-Man: threat or menace? Our readers decide",
            "<html><body><h1>The Daily Bugle</h1><p>Our readers have spoken, and they agree with me: menace. Full poll results inside.</p>"
            "<p><em>J. Jonah Jameson, Editor-in-Chief</em></p>"
            '<img src="https://dailybugle.us1.list-manage.com/track/open.php?u=jjj&id=menace" width="1" height="1" alt="">'
            '<img src="https://click.dailybugle.net/wf/open?upn=pictures-of-spiderman" style="display:none" alt="">'
            "</body></html>",
            ago(days=1, hours=4), msgid="bugle-1", html=True),
    message(("Jeri Hogarth", "jhogarth@hogarthchaokramer.com"), "Retainer",
            "Jessica,\n\nThe retainer is in your account. Please try to keep the property damage under six figures this time.\n\nJ. Hogarth",
            ago(days=3), msgid="jeri-1"),
    message(("Karen Page", "karen@nybulletin.com"), "Quick question for a story",
            "Hi Jessica,\n\nDo you have five minutes for an off-the-record chat about a certain man in a devil costume? Asking for an article. Not for Matt.\n\nKaren",
            ago(days=4), msgid="karen-1"),
    # The stakeout thread (Jess's replies are in Sent).
    message(MATT, STAKEOUT,
            "Jess, Luke, Danny,\n\nThe Hand is moving something through the docks tonight. Rooftop on 46th and 10th, midnight.\n\n"
            "I'll hear you coming, so don't be late.\n\nMatt",
            ago(days=2, hours=6), to=ME, cc=(LUKE, DANNY), msgid="stakeout-1"),
    message(DANNY, f"Re: {STAKEOUT}",
            "I'm in. I'll bring the Iron Fist.\n\nOn Tue, Oct 20, 2026 at 6:30 AM Matt Murdock wrote:\n> The Hand is moving something through the docks tonight.",
            ago(days=2, hours=5), to=MATT, cc=(ME, LUKE), msgid="stakeout-2", refs=("stakeout-1",)),
    message(LUKE, f"Re: {STAKEOUT}",
            "Sweet Christmas. I'll be there. Save me the spot next to Jones.\n\nLuke\n\nOn Tue, Oct 20, 2026 at 7:10 AM Danny Rand wrote:\n> I'm in. I'll bring the Iron Fist.",
            ago(days=2, hours=4), to=MATT, cc=(ME, DANNY), msgid="stakeout-4", refs=("stakeout-1", "stakeout-2", "stakeout-3")),
    message(MATT, f"Re: {STAKEOUT}",
            "Thanks, everyone. Danny, nobody needs the speech about the chi.\n\nMatt",
            ago(hours=20), to=ME, cc=(LUKE, DANNY), msgid="stakeout-6", refs=("stakeout-1", "stakeout-2", "stakeout-3", "stakeout-4", "stakeout-5"), unread=True),
]

sent = [
    message(ME, f"Re: {GYM}",
            "I'm in, as long as nobody makes me do burpees. And Groot's in too: he's the only one who won't complain about leg day.\n\nJess",
            ago(days=1, hours=1), to=CAROL, cc=(TRISH, NEBULA, ROCKET), msgid="gym-3", refs=("gym-1", "gym-2")),
    message(ME, f"Re: {STAKEOUT}",
            "Fine. I'll bring coffee. Nobody bring the Iron Fist speech.\n\nJess\n\nOn Tue, Oct 20, 2026 at 7:10 AM Danny Rand wrote:\n> I'm in. I'll bring the Iron Fist.",
            ago(days=2, hours=4, minutes=30), to=MATT, cc=(LUKE, DANNY), msgid="stakeout-3", refs=("stakeout-1", "stakeout-2")),
    message(ME, f"Re: {STAKEOUT}",
            "Box was empty. Somebody tipped them off. Pizza is on Danny.\n\nJess",
            ago(days=1, hours=8), to=MATT, cc=(LUKE, DANNY), msgid="stakeout-5", refs=("stakeout-1", "stakeout-2", "stakeout-3", "stakeout-4")),
]

(FOLDER / "Inbox").write_text("".join(inbox))
(FOLDER / "Sent").write_text("".join(sent))
print(f"demo: {len(inbox)} messages in Inbox, {len(sent)} in Sent")
