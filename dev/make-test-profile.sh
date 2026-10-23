#!/bin/zsh
# Creates a throwaway Thunderbird profile with fake messages, to test the theme without touching the real profile.
# Usage: dev/make-test-profile.sh [folder]   (default: /tmp/heron-test-profile)

set -euo pipefail

ROOT="${0:A:h:h}"
PROFILE="${1:-/tmp/heron-test-profile}"

rm -rf "$PROFILE"
mkdir -p "$PROFILE/chrome" "$PROFILE/Mail/Local Folders"

# heron's theme and settings come from the extension (HERON_XPIS), as for a real user.
cat > "$PROFILE/user.js" <<'EOF'

// --- Test profile only ---
user_pref("marionette.port", 2829);
user_pref("mail.accountmanager.accounts", "account1");
user_pref("mail.accountmanager.localfoldersserver", "server1");
user_pref("mail.account.account1.server", "server1");
user_pref("mail.server.server1.type", "none");
user_pref("mail.server.server1.hostname", "Local Folders");
user_pref("mail.server.server1.userName", "nobody");
user_pref("mail.server.server1.name", "Dossiers locaux");
user_pref("mail.server.server1.directory-rel", "[ProfD]Mail/Local Folders");
user_pref("mail.provider.suppress_dialog_on_startup", true);
user_pref("mail.accounthub.enabled", false);
user_pref("mail.shell.checkDefaultClient", false);
user_pref("mail.rights.version", 1);
user_pref("mail.spotlight.firstRunDone", true);
user_pref("mail.winsearch.firstRunDone", true);
user_pref("app.update.disabledForTesting", true);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("mailnews.start_page.enabled", false);
user_pref("calendar.timezone.local", "America/Toronto");
// Fake outgoing server (dev/smtp-sink.py) and test identity, to test sending.
user_pref("mail.smtpservers", "smtp1");
user_pref("mail.smtp.defaultserver", "smtp1");
user_pref("mail.smtpserver.smtp1.hostname", "127.0.0.1");
user_pref("mail.smtpserver.smtp1.port", 2525);
user_pref("mail.smtpserver.smtp1.authMethod", 1);
user_pref("mail.smtpserver.smtp1.try_ssl", 0);
user_pref("mail.identity.id1.fullName", "Camille Roy");
user_pref("mail.identity.id1.useremail", "camille@example.com");
user_pref("mail.identity.id1.smtpServer", "smtp1");
user_pref("mail.identity.id1.valid", true);
user_pref("mail.account.account1.identities", "id1");
// Do not read the macOS address book: it holds the user's real contacts.
user_pref("ldap_2.servers.osx.position", 0);
user_pref("ldap_2.servers.osx.uri", "");
EOF

# "Name <address>": the name is RFC 2047 encoded if it has accents, as a real client does.
addr() {
  local name="${1% <*}"
  if [[ "$1" != *"<"* || "$name" != *[^[:ascii:]]* ]]; then
    print -r -- "$1"
  else
    print -r -- "=?UTF-8?B?$(printf %s "$name" | base64)?= <${1##*<}"
  fi
}

msg() { # date sender subject body [status]
  cat <<EOF
From - $1
X-Mozilla-Status: ${5:-0000}
X-Mozilla-Status2: 00000000
From: $(addr "$2")
To: Camille Roy <camille@example.com>
Subject: $3
Date: $1 -0400
Message-ID: <$RANDOM$RANDOM@heron.test>
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit

$4

EOF
}

tmsg() { # date sender subject number refs body [status]
  local refs="" r
  for r in ${=5}; do refs+="<thread-$r@heron.test> "; done
  cat <<EOF
From - $1
X-Mozilla-Status: ${7:-0000}
X-Mozilla-Status2: 00000000
From: $(addr "$2")
To: Camille Roy <camille@example.com>
Subject: $3
Date: $1 -0400
Message-ID: <thread-$4@heron.test>
EOF
  [[ -n "$refs" ]] && printf 'In-Reply-To: <thread-%s@heron.test>\nReferences: %s\n' "${5##* }" "$refs"
  printf 'Content-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: 8bit\n\n%b\n\n' "$6"
}

{
  msg "Mon, 20 Oct 2026 09:13:00" "Bibliothèque municipale <avis@biblio.example>" "Votre réservation est disponible" "Le livre que vous avez réservé vous attend au comptoir."
  msg "Mon, 20 Oct 2026 05:30:00" "bonjour@atelier-velo.example [via Relay] <k3v8q2m1@relay.firefox.com>" "Mise au point d'automne : places disponibles" "Réservez votre mise au point d'automne." 0001
  msg "Sun, 19 Oct 2026 15:33:00" "Gouvernement du Québec <avis@quebec.gouv.qc.ca>" "INVITATION | Forum de consultation" "Vous êtes invité au forum de consultation."
  msg "Sun, 19 Oct 2026 11:32:00" "Mon Compte <no-reply@mail.compte.example>" "Votre lien de connexion est ici" "Connectez-vous à votre compte."
  msg "Fri, 17 Oct 2026 08:39:00" "Club de lecture <club_at_lecture.example_p7d4x2@relay.firefox.com>" "Le livre du mois est choisi" "Découvrez le livre du mois." 0001
  msg "Fri, 17 Oct 2026 06:32:00" "Revue Science <nouvelles@revue.example>" "Les forêts urbaines, un enjeu de santé | Pourquoi les oiseaux migrent la nuit" "Infolettre." 0001
  msg "Thu, 16 Oct 2026 15:46:00" "Comité de quartier <contact@quartier.example>" "Rencontre régionale" "Bonjour." 0001
  msg "Wed, 15 Oct 2026 10:00:00" "Hélène Côté <hc@example.com>" "Confirmation du prochain rendez-vous" "Bonjour Camille." 0001
  # Phishing: the name imitates a brand, with no address in the name.
  msg "Mon, 13 Oct 2026 18:05:00" "Desjardins Accès D <securite@desjardins-verification.com>" "Activité inhabituelle sur votre compte" "Confirmez votre identité."
  # Phishing: the display name imitates a PayPal address, the real sender is elsewhere.
  msg "Tue, 14 Oct 2026 07:20:00" "\"service@paypal.com\" <alerts@paypa1-secure.ru>" "Votre compte est suspendu" "Cliquez ici pour réactiver votre compte."

  # An HTML newsletter with two tracking pixels and an ordinary remote image.
  cat <<'EOF2'
From - Sat, 17 Oct 2026 07:00:00
X-Mozilla-Status: 0000
X-Mozilla-Status2: 00000000
From: Le Quotidien <infolettre@quotidien.example>
To: Camille Roy <camille@example.com>
Subject: Votre infolettre du samedi
Date: Sat, 17 Oct 2026 07:00:00 -0400
Message-ID: <infolettre-1@heron.test>
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

<html><body><h1>Les nouvelles du samedi</h1>
<p><img src="https://images.quotidien.example/une.jpg" width="600" height="300" alt="À la une"></p>
<p>Bonne lecture.</p>
<img src="https://quotidien.us1.list-manage.com/track/open.php?u=abc&id=def" width="1" height="1" alt="">
<img src="https://click.quotidien.example/wf/open?upn=xyz" style="display:none" alt="">
</body></html>

EOF2
  # A message with an attachment, flagged (status 0004), unread.
  cat <<'EOF2'
From - Mon, 12 Oct 2026 08:45:00
X-Mozilla-Status: 0004
X-Mozilla-Status2: 00000000
X-Mozilla-Keys: $label1
From: Olivier Bergeron <ob@example.com>
To: Camille Roy <camille@example.com>
Subject: Version finale du devis
Date: Mon, 12 Oct 2026 08:45:00 -0400
Message-ID: <devis-1@heron.test>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="heronsep"

--heronsep
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit

Bonjour Camille, voici le devis signé en pièce jointe.

--heronsep
Content-Type: application/pdf; name="devis.pdf"
Content-Disposition: attachment; filename="devis.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQKJcTl8uXrCg==
--heronsep--

EOF2

  # A discussion thread, with the history quoted as in real life.
  tmsg "Fri, 28 Aug 2026 12:57:00" "Olivier Bergeron <ob@example.com>" "Avancement du rapport annuel - Comité de quartier" 1 "" \
    "Salut Camille,\n\nOù en est la rédaction du rapport? On aimerait le présenter au comité le mois prochain.\n\nOlivier\n-- \nOlivier Bergeron\nCoordonnateur\nT. 555 555-0127"
  tmsg "Sun, 30 Aug 2026 19:50:00" "Camille Roy <camille@example.com>" "Re: Avancement du rapport annuel - Comité de quartier" 2 "1" \
    "Salut Olivier,\n\nVoici le rapport préliminaire. Les chiffres de l'année sont à la fin.\n\nCamille\n\nLe 28/08/2026 à 12:57, Olivier Bergeron a écrit :\n> Salut Camille,\n>\n> Où en est la rédaction du rapport? On aimerait le présenter au comité le mois prochain.\n>\n> Olivier"
  tmsg "Wed, 09 Sep 2026 14:05:00" "Olivier Bergeron <ob@example.com>" "Re: Avancement du rapport annuel - Comité de quartier" 3 "1 2" \
    "Salut Camille, merci pour le rapport. Je vais prendre le temps de le lire et je reviens avec des questions.\n\nOlivier\n\nDe : Camille Roy <camille@example.com>\nEnvoyé : 30 août 2026 19:50\nÀ : Olivier Bergeron <ob@example.com>\nObjet : Re: Avancement du rapport annuel\n\nSalut Olivier,\n\nVoici le rapport préliminaire. Les chiffres de l'année sont à la fin.\n\nCamille" 0001
  tmsg "Mon, 21 Sep 2026 13:52:00" "Léa-Émilie Fortin <lef@example.com>" "Re: Avancement du rapport annuel - Comité de quartier" 4 "1 2 3" \
    "Bonjour à tous,\n\nLe rapport est clair ; il ne manque que le budget du printemps.\n\nLEF\n\nDe : Olivier Bergeron\nEnvoyé : 9 septembre 2026 14:05\n\nSalut Camille, merci pour le rapport. Je vais prendre le temps de le lire et je reviens avec des questions."
} > "$PROFILE/Mail/Local Folders/Inbox"

# Extensions to preinstall: HERON_XPIS="path/a.xpi:id@a path/b.xpi:id@b"
if [[ -n "${HERON_XPIS:-}" ]]; then
  mkdir -p "$PROFILE/extensions"
  for spec in ${=HERON_XPIS}; do cp "${spec%%:*}" "$PROFILE/extensions/${spec#*:}.xpi"; done
  echo 'user_pref("extensions.autoDisableScopes", 0);' >> "$PROFILE/user.js"
fi

# A userChrome.css to test the CSS edition: HERON_USERCHROME=path/to/userChrome.css
if [[ -n "${HERON_USERCHROME:-}" ]]; then
  cp "$HERON_USERCHROME" "$PROFILE/chrome/userChrome.css"
  echo 'user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);' >> "$PROFILE/user.js"
fi

# Extra preferences: HERON_PREFS='user_pref("a", 1);'
[[ -n "${HERON_PREFS:-}" ]] && echo "$HERON_PREFS" >> "$PROFILE/user.js"

# A sent reply, stored in Sent: used to test search and multi-folder conversations.
tmsg "Tue, 22 Sep 2026 09:10:00" "Camille Roy <camille@example.com>" "Re: Avancement du rapport annuel - Comité de quartier" 5 "1 2 3 4" \
  "Merci Léa-Émilie, je joins la version révisée du rapport.\n\nCamille" 0001 > "$PROFILE/Mail/Local Folders/Sent"

# Quotes: real messages from each mail client (dev/fixtures/quotes), for dev/test-quotes.js.
for f in "${0:A:h}"/fixtures/quotes/*.eml; do
  printf 'From - Mon, 19 Oct 2026 10:00:00\nX-Mozilla-Status: 0001\nX-Mozilla-Status2: 00000000\n'
  cat "$f"
  printf '\n'
done > "$PROFILE/Mail/Local Folders/Quotes"

# Recipients: a thread of two messages sent to many people (dev/test-recipients.js).
many() {
  local out="" i
  for i in {1..18}; do out+="Personne Fictive $i <personne$i@exemple.org>, "; done
  print -r -- "${out%, }"
}
{
  for n in 1 2; do
    printf 'From - Tue, 0%s Sep 2026 10:00:00\nX-Mozilla-Status: 0001\nX-Mozilla-Status2: 00000000\n' "$n"
    printf 'From: Léa-Émilie Fortin <lef@example.com>\nTo: %s\nCc: Camille Roy <camille@example.com>, Olivier Bergeron <ob@example.com>, Hélène Côté <hc@example.com>, Autre Personne <autre@exemple.org>\n' "$(many)"
    printf 'Subject: %sRencontre du grand comité\nDate: Tue, 0%s Sep 2026 10:00:00 -0400\nMessage-ID: <comite-%s@heron.test>\n' "$([[ $n == 2 ]] && echo 'Re: ')" "$n" "$n"
    [[ $n == 2 ]] && printf 'In-Reply-To: <comite-1@heron.test>\nReferences: <comite-1@heron.test>\n'
    printf 'Content-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: 8bit\n\nBonjour à toutes et à tous (message %s).\n\n' "$n"
  done
} > "$PROFILE/Mail/Local Folders/Recipients"

touch "$PROFILE/Mail/Local Folders/Trash" "$PROFILE/Mail/Local Folders/Drafts"
# Demo profile for the README screenshots (HERON_DEMO=1): Jessica Jones's inbox, English interface.
if [[ -n "${HERON_DEMO:-}" ]]; then
  python3 -I "$ROOT/dev/demo-mail.py" "$PROFILE/Mail/Local Folders" >/dev/null
  rm -f "$PROFILE/Mail/Local Folders/Quotes" "$PROFILE/Mail/Local Folders/Recipients"
  cat >> "$PROFILE/user.js" <<'EOF'
user_pref("intl.locale.requested", "en-US");
user_pref("mail.server.server1.name", "Alias Investigations");
user_pref("mail.identity.id1.fullName", "Jessica Jones");
user_pref("mail.identity.id1.useremail", "jess@thedefenders.we");
EOF
fi

echo "$PROFILE"
