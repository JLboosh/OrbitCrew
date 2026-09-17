import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Chip, Text } from '@/components/ui';
import {
  MAX_WORKOUT_CATEGORIES,
  WORKOUT_CATEGORIES,
  describeCategories,
  type WorkoutCategory,
  type WorkoutCategoryKey,
} from '@/lib/workoutTypes';
import { useTheme } from '@/theme';

export interface WorkoutTypePickerProps {
  selected: WorkoutCategoryKey[];
  onChange: (next: WorkoutCategoryKey[]) => void;
}

/**
 * "What are you training today?"
 *
 * The first thing in the workout flow, and deliberately the ONLY thing on screen
 * at that moment. The previous flow opened straight onto an exercise search across
 * the whole library, which is a decision nobody makes in that order — you know
 * it's leg day before you know whether you're starting with squats or the leg
 * press. Choosing the day first is also what makes the exercise list short enough
 * to scan one-handed.
 *
 * MULTI-SELECT, BUT NOT A FREE-FOR-ALL. Real training days are combinations —
 * chest and triceps, back and biceps — so this is a checkbox grid rather than a
 * radio group, capped at four to match the CHECK constraint and to keep the
 * resulting label ("Chest + Triceps") readable in a history row.
 *
 * TILES, NOT A LIST. Large emoji targets are faster to hit than list rows and are
 * the one place in this app where decoration does real work: 🦵 is recognisable
 * at a glance in a way that the word "Legs" in 15pt type is not.
 */
export function WorkoutTypePicker({ selected, onChange }: WorkoutTypePickerProps) {
  const theme = useTheme();
  const [showRefinements, setShowRefinements] = useState(() =>
    selected.some((key) => isRefinement(key)),
  );

  const atLimit = selected.length >= MAX_WORKOUT_CATEGORIES;

  const toggle = (key: WorkoutCategoryKey) => {
    if (selected.includes(key)) {
      onChange(selected.filter((existing) => existing !== key));
      return;
    }

    // Full Body and Custom mean "no filter", so combining them with a specific
    // muscle group would be contradictory. Picking one replaces the selection.
    if (key === 'full_body' || key === 'custom') {
      onChange([key]);
      return;
    }

    const withoutBroad = selected.filter(
      (existing) => existing !== 'full_body' && existing !== 'custom',
    );
    if (withoutBroad.length >= MAX_WORKOUT_CATEGORIES) return;
    onChange([...withoutBroad, key]);
  };

  const grid = WORKOUT_CATEGORIES.filter(
    (category) =>
      category.tier === 'primary' && category.key !== 'full_body' && category.key !== 'custom',
  );
  const wide = WORKOUT_CATEGORIES.filter(
    (category) => category.key === 'full_body' || category.key === 'custom',
  );
  const refinements = WORKOUT_CATEGORIES.filter((category) => category.tier === 'refinement');

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Workout type. Choose one or more."
        style={[styles.grid, { gap: theme.spacing.md }]}
      >
        {grid.map((category) => (
          <TypeTile
            key={category.key}
            category={category}
            selected={selected.includes(category.key)}
            disabled={atLimit && !selected.includes(category.key)}
            onPress={() => toggle(category.key)}
          />
        ))}
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        {wide.map((category) => (
          <TypeTile
            key={category.key}
            category={category}
            selected={selected.includes(category.key)}
            onPress={() => toggle(category.key)}
            wide
          />
        ))}
      </View>

      {/* Finer muscle groups, folded away. On screen by default they would double
          the height of the first thing a member sees, for a split most people
          never use. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          showRefinements ? 'Hide individual muscle groups' : 'Show individual muscle groups'
        }
        accessibilityState={{ expanded: showRefinements }}
        onPress={() => setShowRefinements((open) => !open)}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Text variant="caption" tone="primary" style={{ fontWeight: '600' }}>
          {showRefinements ? '− Individual muscle groups' : '+ Individual muscle groups'}
        </Text>
      </Pressable>

      {showRefinements ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" tone="muted">
            For splits like Chest + Triceps or Back + Biceps.
          </Text>
          <View style={[styles.chips, { gap: theme.spacing.sm }]}>
            {refinements.map((category) => (
              <Chip
                key={category.key}
                role="checkbox"
                label={category.label}
                active={selected.includes(category.key)}
                disabled={atLimit && !selected.includes(category.key)}
                accessibilityHint={category.hint}
                onPress={() => toggle(category.key)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {/* Reads back the selection in the exact words the workout will be saved
          and shown under, so there is no surprise in the history list later. */}
      <Card variant="outline">
        {selected.length === 0 ? (
          <Text variant="caption" tone="muted">
            Pick at least one. Choose Custom Workout if you would rather browse everything.
          </Text>
        ) : (
          <>
            <Text variant="subheading">{describeCategories(selected)}</Text>
            <Text variant="caption" tone="muted">
              {atLimit
                ? `That is the maximum of ${MAX_WORKOUT_CATEGORIES}. Deselect one to swap it.`
                : 'You can still add any exercise you like once the workout starts.'}
            </Text>
          </>
        )}
      </Card>
    </View>
  );
}

function isRefinement(key: WorkoutCategoryKey): boolean {
  return WORKOUT_CATEGORIES.some(
    (category) => category.key === key && category.tier === 'refinement',
  );
}

function TypeTile({
  category,
  selected,
  disabled = false,
  wide = false,
  onPress,
}: {
  category: WorkoutCategory;
  selected: boolean;
  disabled?: boolean;
  wide?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={category.label}
      accessibilityHint={category.hint}
      style={({ pressed }) => [
        styles.tile,
        {
          // Two per row on a phone, with the wide options spanning the width.
          flexBasis: wide ? '100%' : '46%',
          flexGrow: 1,
          minHeight: wide ? 64 : 108,
          flexDirection: wide ? 'row' : 'column',
          borderRadius: theme.radius.lg,
          borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface,
          padding: theme.spacing.md,
          gap: theme.spacing.sm,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text
        style={{ fontSize: wide ? 22 : 30, lineHeight: wide ? 28 : 36 }}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {category.emoji}
      </Text>
      <Text variant="subheading" tone={selected ? 'primary' : 'default'}>
        {category.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
