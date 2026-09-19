import { useState } from 'react';
import { View } from 'react-native';

import {
  normaliseUsernameQuery,
  useAcceptFriendRequest,
  useFindProfileByUsername,
  useFriendRequests,
  useFriends,
  useMyPrivacySettings,
  useRemoveFriendship,
  useSendFriendRequest,
  useUpdatePrivacySettings,
  type FriendSummary,
} from '@/api';
import {
  Avatar,
  Button,
  Card,
  Screen,
  SectionHeader,
  Text,
  TextField,
  useConfirm,
} from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { useTheme } from '@/theme';

/**
 * Handles are 3-24 characters (`profiles_username_format`), but the search accepts
 * anything non-empty and reports no match rather than refusing to look. Telling
 * someone their query is too short is unhelpful when they are simply working from
 * the wrong handle — which is the common case, because handles are generated at
 * signup and are not the name the member typed.
 */
const USERNAME_MIN_LENGTH = 3;

/**
 * Friends: find people, send and answer requests, see who you are connected to.
 *
 * WHY SEARCH IS EXACT-MATCH
 * -------------------------
 * This screen is the UI for `find_profile_by_username`, a SECURITY DEFINER lookup
 * that matches a whole username, honours the target's `discoverable_by_username`
 * setting, and excludes blocks in both directions. It is exact on purpose: a
 * prefix search over `profiles` would let any account page through the entire user
 * base, which is the thing the function was written to prevent. So "search by
 * username" here means "look someone up by the handle they gave you", and the copy
 * says that rather than implying a directory.
 *
 * The data layer for all of this already existed and had no screen — every hook
 * below was written and then never mounted anywhere.
 */
export default function FriendsScreen() {
  const theme = useTheme();
  const confirm = useConfirm();

  const { data: friends, isLoading: loadingFriends } = useFriends();
  const { data: requests } = useFriendRequests();
  const { data: privacy } = useMyPrivacySettings();
  const updatePrivacy = useUpdatePrivacySettings();

  const sendRequest = useSendFriendRequest();
  const acceptRequest = useAcceptFriendRequest();
  const removeFriendship = useRemoveFriendship();

  const [query, setQuery] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  // Strips a pasted "@", so "@sam" finds sam.
  const trimmed = normaliseUsernameQuery(query);
  const searching = trimmed.length > 0;
  const search = useFindProfileByUsername(trimmed, searching);

  const incoming = requests?.incoming ?? [];
  const outgoing = requests?.outgoing ?? [];

  const alreadyKnown = (userId: string) =>
    (friends ?? []).some((friend) => friend.userId === userId) ||
    incoming.some((friend) => friend.userId === userId) ||
    outgoing.some((friend) => friend.userId === userId);

  const send = (userId: string) => {
    setActionError(null);
    sendRequest.mutate(userId, {
      onSuccess: () => setSentTo(userId),
      onError: (err) => setActionError(errorMessage(err, 'Could not send that request.')),
    });
  };

  const accept = (userId: string) => {
    setActionError(null);
    acceptRequest.mutate(userId, {
      onError: (err) => setActionError(errorMessage(err, 'Could not accept that request.')),
    });
  };

  const remove = async (friend: FriendSummary, kind: 'decline' | 'cancel' | 'unfriend') => {
    setActionError(null);

    // Unfriending loses the connection on both sides, so it is confirmed. A
    // decline or a cancel is cheap and reversible by asking again.
    if (kind === 'unfriend') {
      const ok = await confirm({
        title: `Remove ${friend.displayName}?`,
        message:
          'You will stop seeing each other as friends. Anything either of you shared with friends only becomes private again.',
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (!ok) return;
    }

    removeFriendship.mutate(friend.userId, {
      onError: (err) => setActionError(errorMessage(err, 'Could not update that friendship.')),
    });
  };

  return (
    <Screen title="Friends" subtitle="Find people you train with.">
      {/* ------------------------------------------------------------------
          Search.
          ------------------------------------------------------------------ */}
      <Card>
        <SectionHeader title="Add a friend" />

        <TextField
          label="Username"
          hint="Their exact handle, not their name. It is on their Profile screen, under their picture."
          value={query}
          onChangeText={(next) => {
            setQuery(next);
            setSentTo(null);
            setActionError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="alex"
        />

        {!searching ? null : search.isLoading ? (
          <Text variant="caption" tone="muted">
            Looking…
          </Text>
        ) : search.isError ? (
          <Text variant="caption" tone="danger">
            {errorMessage(search.error, 'Could not run that search.')}
          </Text>
        ) : search.data ? (
          <PersonRow
            person={{
              userId: search.data.id,
              username: search.data.username,
              displayName: search.data.display_name,
              avatarUrl: search.data.avatar_url,
            }}
            action={
              sentTo === search.data.id ? (
                <Text variant="caption" tone="success">
                  Request sent
                </Text>
              ) : alreadyKnown(search.data.id) ? (
                <Text variant="caption" tone="muted">
                  Already connected
                </Text>
              ) : (
                <Button
                  label="Add friend"
                  loading={sendRequest.isPending}
                  onPress={() => send(search.data!.id)}
                />
              )
            }
          />
        ) : (
          /* An opted-out member is indistinguishable from a wrong handle, and
             deliberately so: saying "this person exists but is not findable"
             would leak exactly what the setting exists to hide. */
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="caption" tone="muted">
              No match for “{trimmed}”.
            </Text>
            <Text variant="caption" tone="subtle">
              {trimmed.length < USERNAME_MIN_LENGTH
                ? `Handles are at least ${USERNAME_MIN_LENGTH} characters, so this is not one. Ask them to open Profile and read the handle under their picture — signup generates it, so it is often not the name they chose.`
                : 'Handles are generated at signup, so it is often not the name they chose. Ask them to check Profile — and note anyone can turn off being findable, in which case they will need to add you instead.'}
            </Text>
          </View>
        )}

        {actionError ? (
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
            {actionError}
          </Text>
        ) : null}
      </Card>

      {/* ------------------------------------------------------------------
          Your own discoverability, stated here rather than only buried in
          Profile: this is the screen where it is obvious why it matters.
          ------------------------------------------------------------------ */}
      {privacy && !privacy.discoverable_by_username ? (
        <Card variant="outline">
          <Text variant="subheading">You cannot be found by username</Text>
          <Text variant="caption" tone="muted">
            People who know your handle cannot send you a request while this is off. You can still
            add them yourself.
          </Text>
          <Button
            label="Let people find me by username"
            variant="secondary"
            onPress={() => updatePrivacy.mutate({ discoverable_by_username: true })}
          />
        </Card>
      ) : null}

      {/* ------------------------------------------------------------------
          Requests waiting on you, first: they are the only thing here that
          needs an answer.
          ------------------------------------------------------------------ */}
      {incoming.length > 0 ? (
        <Card>
          <SectionHeader title={`Requests (${incoming.length})`} />
          {incoming.map((person) => (
            <PersonRow
              key={person.userId}
              person={person}
              action={
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  <Button label="Accept" onPress={() => accept(person.userId)} />
                  <Button
                    label="Decline"
                    variant="ghost"
                    onPress={() => void remove(person, 'decline')}
                  />
                </View>
              }
            />
          ))}
        </Card>
      ) : null}

      {outgoing.length > 0 ? (
        <Card>
          <SectionHeader title="Sent" />
          {outgoing.map((person) => (
            <PersonRow
              key={person.userId}
              person={person}
              action={
                <Button
                  label="Cancel"
                  variant="ghost"
                  onPress={() => void remove(person, 'cancel')}
                />
              }
            />
          ))}
        </Card>
      ) : null}

      {/* ------------------------------------------------------------------
          The list.
          ------------------------------------------------------------------ */}
      <Card>
        <SectionHeader title={friends?.length ? `Friends (${friends.length})` : 'Friends'} />

        {loadingFriends ? (
          <Text variant="caption" tone="muted">
            Loading…
          </Text>
        ) : friends && friends.length > 0 ? (
          friends.map((person) => (
            <PersonRow
              key={person.userId}
              person={person}
              action={
                <Button
                  label="Remove"
                  variant="ghost"
                  onPress={() => void remove(person, 'unfriend')}
                />
              }
            />
          ))
        ) : (
          <Text variant="caption" tone="muted">
            No friends yet. Friends can see what you choose to share — nothing is shared by default,
            and adding someone changes none of your settings.
          </Text>
        )}
      </Card>
    </Screen>
  );
}

function PersonRow({ person, action }: { person: FriendSummary; action: React.ReactNode }) {
  const theme = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        minHeight: theme.minTouchTarget,
        flexWrap: 'wrap',
      }}
    >
      <Avatar id={person.userId} name={person.displayName} imageUrl={person.avatarUrl} size={40} />
      <View style={{ flex: 1, minWidth: 120 }}>
        <Text variant="body" numberOfLines={1}>
          {person.displayName}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          @{person.username}
        </Text>
      </View>
      {action}
    </View>
  );
}
