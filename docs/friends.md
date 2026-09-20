# Friends v1: profiles and flight counts

Selected 21 September 2026. PAR-12 records the scope decisions; PAR-13 owns server
permissions and PAR-14 owns the app experience. Validation and delivery evidence are
recorded separately below.

## First experience

Open **Friends**, sign in through Account if needed, and choose a social display name.
The initials avatar and name are separate from the private pilot/export profile. Saving
this name enables invitations; sign-in alone does not publish a social profile.

Send your private invite code through the phone's share sheet. A recipient enters it in
Friends and sends a request, which you can accept or decline. Accepted friends can open
each other's profile to see the display name, initials and **Backed-up flights** count.
Pending requests show names only. There is no public pilot directory.

Requests can be cancelled, friends removed, and pilots blocked or unblocked. Removing or
blocking closes future server access. Unblocking does not restore a previous friendship.
Regenerating an invite code invalidates the old code without changing existing connections.

This stage has no individual flight list, activity feed, kudos, route sharing, photos,
notifications or shared replay. Postcard and file sharing continue through the existing
external share menus.

## Count and privacy boundaries

The count is derived by the server from completed or saved-partial backed-up summaries with
complete metrics, using the archive reader's completeness rules. Zero-fix/no-track flights
with metrics count; an IGC upload or download is not required. Unfinished flights and rows
without complete metrics do not count. Pending uploads and deletions can make this differ
from the owner's local logbook. A failed read is an error, never a zero count.

Social profiles, invitation codes, relationships and blocks are separate from private
profiles, flights and IGC storage. Narrow authenticated RPCs return only the approved social
fields. Clients cannot submit a flight count or read another pilot's private backup rows.
Account deletion cascades social records after the existing private storage cleanup.

Social data is held only in memory and follows the currently signed-in account, not the
journal's retained owner. Sign-out, account changes, backgrounding and loss of connectivity
clear visible social data. Late requests cannot populate another account's view. Focus,
reconnect and explicit Refresh obtain current authorization; there is no background polling
or real-time delivery. Remote removal becomes visible on the next successful authorization
check, not as a push notification.

## Backend and release order

Apply `20260921130000_friends.sql` after the existing private-archive migration. It is
additive and leaves private backup access policies unchanged. It introduces explicit
social-profile setup, random rotatable codes, canonical requests, blocking, and constrained
profile/count reads. Requests and relationship changes serialize per pair; current request
identities protect newer requests from delayed cancellation/removal.

Invalid code attempts are bounded server-side. Exact-code requests do not provide a search
or enumeration API. A code grants the ability to request a connection, not profile access.

Verify the migration locally before hosted rollout, then build a matching Android preview.
An older APK can continue private backup; it does not gain Friends. A new APK against a
server without the migration must report social unavailability without blocking recording
or the local journal. No new native dependency is required.

## Acceptance record

Implementation and verification are in progress. No hosted or physical-device acceptance
is claimed by this initial record.

Required scenarios:

- Two independent accounts set up names, exchange a code, accept and view profiles; a third
  account and an anonymous caller cannot read their profiles or counts.
- Invalid/self/duplicate/crossed requests, rotation, stale requests, concurrent accept,
  removal and blocking obey server permissions. Unblocking requires a fresh request.
- Count changes reflect finished backup and deletion, including partial/no-track summaries;
  private notes, registration, email, coordinates and IGCs remain inaccessible.
- Sign-out/account switch during reads and writes, offline failure, focus/reconnect refresh,
  and account deletion do not expose stale social data or erase local flights.
- The existing recorder, restoration and external sharing retain their behavior.

PAR-22 production testing and PAR-28 live GPS acceptance remain deferred independently.
