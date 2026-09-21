import { Pressable, Text, View } from 'react-native';
import { Avatar, Card, LinkButton } from '@/components/ui';
import type { FriendshipAction, FriendshipSummary } from '@/social/types';
import { friendInitials, relationshipActions } from './presentation';
import { friendsStyles as styles } from './styles';

export function RelationshipCard({ relation, disabled, onAction, onProfile }: {
  relation: FriendshipSummary;
  disabled: boolean;
  onAction(action: FriendshipAction): void;
  onProfile(): void;
}) {
  return <Card><View style={styles.card}>
    <View style={styles.row}>
      <Avatar initials={friendInitials(relation.displayName)} />
      <View style={styles.rowText}>
        <Text style={styles.name}>{relation.displayName}</Text>
        {relation.username ? <Text style={styles.body}>@{relation.username}</Text> : null}
        {relation.state === 'incoming' ? <Text style={styles.helper}>Wants to be your friend</Text> : null}
        {relation.state === 'outgoing' ? <Text style={styles.helper}>Waiting for their reply</Text> : null}
        {relation.state === 'blocked' ? <Text style={styles.helper}>Unblocking does not add them as a friend.</Text> : null}
      </View>
    </View>
    {relation.state === 'accepted' ? <LinkButton label={`View ${relation.displayName}’s profile`} onPress={onProfile} disabled={disabled} /> : null}
    <View style={styles.actions}>
      {relationshipActions(relation.state).map(({ action, label }) => <Pressable key={action}
        accessibilityRole="button" accessibilityLabel={`${label}: ${relation.displayName}`}
        accessibilityState={{ disabled }} disabled={disabled} onPress={() => onAction(action)}
        style={({ pressed }) => [styles.action, (pressed || disabled) && styles.disabled]}>
        <Text style={[styles.actionText, (action === 'block' || action === 'remove') && styles.danger]}>{label}</Text>
      </Pressable>)}
    </View>
  </View></Card>;
}
