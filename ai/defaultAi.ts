import { maxBy, meanBy, minBy, remove, sortBy, sumBy, take } from 'lodash';
import { knapsack, KnapsackItem } from '../algorithms';
import { Card, CardType } from '../card-types/card';
import { Enchantment } from '../card-types/enchantment';
import { Item } from '../card-types/item';
import { Unit, isUnit } from '../card-types/unit';
import { TransformDamaged } from '../cards/mechanics/decaySpecials';
import { Flying, Lethal, Shielded } from '../cards/mechanics/skills';
import { ClientGame } from '../clientGame';
import { DeckList } from '../deckList';
import { GamePhase } from '../game';
import { EvalContext } from '../mechanic';
import { Player } from '../player';
import { Resource, ResourceTypeNames } from '../resource';
import { AI } from './ai';
import { aiList } from './aiList';
import { DeckBuilder } from './deckBuilder';
import { RandomBuilder } from './randomBuilder';
import { ChoiceHeuristic } from './heuristics';
import { BlockOutcome, CombatAnalyzer } from './combatAnalyer';
import { Permanent } from '../card-types/permanent';

/**
 * Represents an action (playing a card, an item or an enchantment)
 * whose value has already been determined (By a heuristic)
 */
interface EvaluatedAction {
    score: number;
    cost: number;
    card?: Card;
    enchantmentTarget?: Enchantment;
    target?: Permanent;
    host?: Unit;
}

/**
 * A heuristics based A.I
 *
 * This is the default opponent for singleplayer.
 *
 * It is built on heuristics and does not use any tree search based algorithm.
 * As such, it runs quite fast but is prone to making short sighted moves.
 *
 * Known Flaws
 * - Doesn't currently consider the value of enchantments when empowering them (only their cost)
 * - Doesn't currently take most global effects into play such as the effect of Death's Ascendence
 *   (which makes it pointless to play certain units as they will die instantly)
 * - See documentation of attack and block methods for weaknesses in attack/blocking logic
 *
 */
export class DefaultAI extends AI {
    protected enemyNumber: number;
    protected aiPlayer: Player;

    public static getDeckbuilder(): DeckBuilder {
        return new RandomBuilder();
    }

    /**
     * Creates an instance of DefaultAI.
     *
     * @param playerNumber - The number of the player the A.I will control
     * @param game - The interface by which the A.I will take actions and observe state
     * @param deck - The DeckList of the deck the A.I will play
     * @param animator - An animator to avoid acting during animations
     */
    constructor(playerNumber: number, game: ClientGame, deck: DeckList) {
        super(playerNumber, game, deck);
        this.aiPlayer = this.game.getPlayer(this.playerNumber);
        this.enemyNumber = this.game.getOtherPlayerNumber(this.playerNumber);
        this.game.setOwningPlayer(this.playerNumber);

        this.game.promptCardChoice = this.makeChoice.bind(this);
    }

    /** Triggers the A.I to consider what its next action should be */
    protected think() {
        if (this.game.getPhase() === GamePhase.Block) {
            this.block();
        } else {
            if (this.game.canPlayResource()) {
                this.sequenceActions([
                    this.playResource,
                    this.selectActions,
                    this.attack
                ]);
            } else {
                this.sequenceActions([this.selectActions, this.attack]);
            }
        }
    }

    /** Returns a deckbuilder to be used for limited tournaments */
    public getDeckbuilder(): DeckBuilder {
        throw new RandomBuilder();
    }

    /** A simple heuristic to determine which card is best to draw
       This heuristic assumes it is best to draw cards whose cost
       is close to the amount of resources we have.*/
    protected cardDrawHeuristic(card: Card): number {
        return Math.abs(
            this.aiPlayer.getPool().getNumeric() - card.getCost().getNumeric()
        );
    }

    /** Decides which cards of a set of choices to choose to draw. */
    protected evaluateToDraw(
        choices: Card[],
        min: number,
        max: number
    ): Card[] {
        return take(
            sortBy(choices, card => this.cardDrawHeuristic(card)),
            max
        );
    }

    /** Decides which cards of a set of choices to discard
     * The heuristic is the inverse of the to draw heuristic. */
    protected evaluateToDiscard(
        choices: Card[],
        min: number,
        max: number
    ): Card[] {
        return take(
            sortBy(choices, card => -this.cardDrawHeuristic(card)),
            min
        );
    }

    /** Decides which cards of a set to replace.
     * We replace a card if we think it is worse than the average card in our deck based on the card draw heuristic. */
    protected evaluateToReplace(
        choices: Card[],
        min: number,
        max: number
    ): Card[] {
        const worst = sortBy(choices, card => -this.cardDrawHeuristic(card));
        const mandatory = take(worst, min);
        let optional = worst.slice(min);
        if (optional.length > 0) {
            const average = meanBy(
                this.deck.getUniqueCards(),
                this.cardDrawHeuristic.bind(this)
            );
            optional = optional.filter(
                card => this.cardDrawHeuristic(card) > average
            );
            optional = sortBy(optional, this.cardDrawHeuristic.bind(this));
        }
        return mandatory.concat(take(optional, max - mandatory.length));
    }

    /** A heuristic that chooses the unit with the highest total stats (all choices must be Units) */
    protected highestStatHeuristic(
        choices: Card[],
        min: number,
        max: number
    ): Card[] {
        return take(
            sortBy(choices as Unit[], unit => -unit.getStats()),
            max
        );
    }

    /** Get the appropriate heuristic for making a choice */
    protected getHeuristic(
        heuristicType: ChoiceHeuristic
    ): (choices: Card[], min: number, max: number) => Card[] {
        switch (heuristicType) {
            case ChoiceHeuristic.DrawHeuristic:
                return this.evaluateToDraw.bind(this);
            case ChoiceHeuristic.DiscardHeuristic:
                return this.evaluateToDiscard.bind(this);
            case ChoiceHeuristic.HighestStatsHeuristic:
                return this.highestStatHeuristic.bind(this);
            case ChoiceHeuristic.ReplaceHeuristic:
                return this.evaluateToReplace.bind(this);
        }
    }

    /** Returns the cards that should be chosen for a given choice based on its heuristic */
    protected getCardToChoose(
        options: Array<Card>,
        min: number,
        max: number,
        heuristicType: ChoiceHeuristic
    ) {
        if (options.length < min) {
            return options;
        }
        const evaluator = this.getHeuristic(heuristicType);
        const choices = evaluator(options, min, max);
        if (choices.length > max || choices.length < min) {
            console.log('bug in evaluator', ChoiceHeuristic[heuristicType]);
        }
        return evaluator(options, min, max);
    }

    /** Makes a choice when requested to by the game engine (such as what cards to mulligan) */
    protected makeChoice(
        player: number,
        options: Array<Card>,
        min: number = 1,
        max: number = 1,
        callback: ((cards: Card[]) => void) | null = null,
        message: string,
        heuristicType: ChoiceHeuristic
    ) {
        if (!callback) {
            return;
        }
        this.game.deferChoice(player, options, min, max, callback);
        if (player !== this.playerNumber) {
            return;
        }

        const choiceCards = this.getCardToChoose(
            options,
            min,
            max,
            heuristicType
        );
        setTimeout(
            () => this.game.makeChoice(this.playerNumber, choiceCards),
            0
        );
    }

    /** Gets the best target for a card with a targeter.
     * The best target is considered to be the one with the highest evaluateTarget value.
     */
    protected getBestTarget(card: Card): EvaluatedAction {
        const targets = card.getTargeter().getValidTargets(card, this.game);
        const best = maxBy(targets, target =>
            card.evaluateTarget(target, this.game, new Map())
        );
        if (!best) {
            return { score: 0, cost: card.getCost().getNumeric(), card: card };
        }
        return {
            target: best,
            score: card.evaluateTarget(best, this.game, new Map()),
            cost: card.getCost().getNumeric(),
            card: card
        };
    }

    /**
     * Evaluates a card based on its value and the value of its target.
     *
     * @param  card - The card to be evaluated
     * @returns - The EvaluatedAction with the score and any targets
     */
    protected evaluateCard(card: Card): EvaluatedAction {
        let result: EvaluatedAction = {
            score: 0,
            cost: card.getCost().getNumeric(),
            card: card
        };
        if (card.getTargeter().needsInput()) {
            const best = this.getBestTarget(card);
            if (best.score > 0 || !card.getTargeter().isOptional()) {
                result = best;
            }
        }
        if (card.getCardType() === CardType.Item) {
            result.host = this.getBestHost(card as Item);
        }
        result.score += card.evaluate(this.game, EvalContext.Play, new Map());
        return result;
    }

    /**
     * Creates an evaluated action from an enchantment.
     *
     * Currently the score is based on the ratio between the enchantments cost and its power.
     * @param enchantment - The enchantment to evaluate
     */
    protected evaluateEnchantment(enchantment: Enchantment): EvaluatedAction {
        const modifyCost = enchantment.getModifyCost().getNumeric();
        const playCost = enchantment.getCost().getNumeric();
        return {
            enchantmentTarget: enchantment,
            cost: modifyCost,
            score: playCost / (modifyCost * enchantment.getPower())
        };
    }

    /**
     * Selects a series of actions to take.
     * Currently there are two actions, playing a card or modifying an enchantment.
     *
     * All actions have a energy cost thus to determine which ones to use we compute their heuristic values.
     * Then we use a knapsack algorithm to get the highest total value of actions with our available energy.
     *
     */
    protected selectActions() {
        const playableCards = this.aiPlayer
            .getHand()
            .filter(card => card.isPlayable(this.game));
        const modifiableEnchantments = this.getModifiableEnchantments();
        const energy = this.aiPlayer.getPool().getNumeric();
        const actions: EvaluatedAction[] = playableCards
            .map(card => {
                try {
                    return this.evaluateCard(card);
                } catch (e) {
                    console.error('Error while evaluating', card, 'got', e);
                    return { score: 0, cost: 0 };
                }
            })
            .concat(
                modifiableEnchantments.map(enchantment => {
                    return this.evaluateEnchantment(enchantment);
                })
            );

        const actionsToRun = Array.from(
            knapsack(
                energy,
                actions.map(action => {
                    return {
                        w: action.cost,
                        b: action.score,
                        data: action
                    } as KnapsackItem<EvaluatedAction>;
                })
            ).set
        ).map(item => item.data);

        const best = maxBy(actionsToRun, evaluated => evaluated.score);
        if (best) {
            this.addActionToSequence(this.selectActions, true);
            this.addActionToSequence(() => this.runEvaluatedAction(best), true);
        }

        return true;
    }

    /** Plays a card based on an action */
    protected runCardPlayAction(action: EvaluatedAction) {
        const targets: Permanent[] = [];
        const host = action.host;
        const toPlay = action.card;
        if (!toPlay) {
            throw new Error('A.I card play lacks card');
        }
        if (action.target) {
            targets.push(action.target);
        }
        return this.game.playCardExtern(toPlay, targets, host);
    }

    /** Runs an action (either playing a card or modifying an enchantment) */
    protected runEvaluatedAction(action: EvaluatedAction): boolean {
        if (action.card) {
            return this.runCardPlayAction(action);
        } else if (action.enchantmentTarget) {
            return this.game.modifyEnchantment(
                this.aiPlayer,
                action.enchantmentTarget
            );
        }
        console.error('Failed to run evaluated action', action);
        return false;
    }

    /** Returns the enchantments we have enough energy to empower or diminish */
    protected getModifiableEnchantments() {
        return this.game
            .getBoard()
            .getAllEnchantments()
            .filter(enchant => this.game.canModifyEnchantment(enchant));
    }

    /**
     * Gets the best host for an item.
     * Currently it simply returns the unit with the highest value multiplier (ignoring the properties of the item).
     * @param item The item to find a host for
     */
    protected getBestHost(item: Item): Unit {
        const validHosts = item
            .getHostTargeter()
            .getValidTargets(item, this.game)
            .filter(isUnit);
        const best = maxBy(validHosts, host =>
            host.getMultiplier(
                this.game,
                EvalContext.NonlethalRemoval,
                new Map()
            )
        );
        if (best === undefined) {
            throw new Error('A.I could not find host for item');
        }
        return best;
    }

    /** Gets the difference in resources (not energy) between two values */
    protected getReqDiff(current: Resource, needed: Resource) {
        const diffs = {
            total: 0,
            resources: new Map<string, number>()
        };
        for (const resourceType of ResourceTypeNames) {
            diffs.resources.set(
                resourceType,
                Math.max(
                    needed.getOfType(resourceType) -
                        current.getOfType(resourceType),
                    0
                )
            );
            const val = diffs.resources.get(resourceType);
            if (val) {
                diffs.total += val;
            }
        }
        return diffs;
    }

    /** Returns the card whose resource pre reqs are not met, but are the closest to being met */
    protected getClosestUnmetRequirement(cards: Card[]) {
        return minBy(
            cards.filter(
                card =>
                    this.getReqDiff(this.aiPlayer.getPool(), card.getCost())
                        .total !== 0
            ),
            card =>
                this.getReqDiff(this.aiPlayer.getPool(), card.getCost()).total
        );
    }

    /** Computes the most common resource among a set of cards (such as a deck or hand) */
    protected getMostCommonResource(cards: Card[]): string {
        const total = new Resource(0);
        for (const card of cards) {
            total.add(card.getCost());
        }
        return maxBy(ResourceTypeNames, type =>
            total.getOfType(type)
        ) as string;
    }

    /**
     * Decides what resource to play next based on the following heuristic.
     *
     * If the A.I has unplayable cards it in its hand, it looks at its hand and decides which
     * card it is closest to being able to play but is not yet able to. It chooses a resource
     * which gets it closer to playing that card.
     *
     * Otherwise it applies the same logic, but to its deck list.
     *
     * Finally, if it can play every card in its hand and deck, it simply plays the most common resource
     * in its deck (based on average card cost).
     *
     * @returns - The name of the resource to play
     */
    protected getResourceToPlay(): string {
        const deckCards = this.deck.getUniqueCards();
        const closestCardInHand = this.getClosestUnmetRequirement(
            this.aiPlayer.getHand()
        );
        const closestCardInDeck = this.getClosestUnmetRequirement(deckCards);
        const closestCard = closestCardInHand || closestCardInDeck;

        if (closestCard) {
            const diff = this.getReqDiff(
                this.aiPlayer.getPool(),
                closestCard.getCost()
            );
            return maxBy(ResourceTypeNames, type =>
                diff.resources.get(type)
            ) as string;
        } else {
            return this.getMostCommonResource(deckCards);
        }
    }

    protected playResource() {
        return this.game.playResource(this.getResourceToPlay());
    }

    // Attacking/Blocking -------------------------------------------------------------------------

    /**
     * Chooses which, if any, units to attack with.
     * The A.I will choose to attack with any units it would not block if it were the opponent.
     * That is to say, any unit where the canFavorablyBlock function returns false for all enemy units.
     *
     * Known Flaws
     *  - The A.I should attack if it could guarantee lethal damage regardless of trades, but that is not implemented.
     *  - The A.I should consider potential multi-blocks from the enemy, but it dose not.
     *  - The A.I should consider whether it is best to leave a unit on defense, even if its a good attacker
     *    e.g if the enemy has much more life than us and attacking with that unit will give them good attacks.
     *
     */
    protected attack() {
        const potentialAttackers = this.game
            .getBoard()
            .getPlayerUnits(this.playerNumber)
            .filter(unit => unit.canAttack())
            .filter(unit => unit.getDamage() > 0);
        const potentialBlockers = this.game
            .getBoard()
            .getPlayerUnits(this.enemyNumber)
            .filter(unit => !unit.isExhausted());

        for (const attacker of potentialAttackers) {
            let hasBlocker = false;
            for (const blocker of potentialBlockers) {
                if (this.canFavorablyBlock(attacker, blocker)) {
                    hasBlocker = true;
                    break;
                }
            }
            if (!hasBlocker) {
                this.game.declareAttacker(attacker);
            }
        }
        return true;
    }

    /**
     * Analyzes whether a blocker can favorably block an attacker.
     * A block is considered favorable under any of the following circumstances
     *   1. Only the attacker would die
     *   2. Neither the attacker nor the blocker would die
     *   3. Both the attacker and the blocker die, but the attacker is more valuable than the blocker.
     *
     * Notably, this function cannot handle blocking with multiple units (even though that is legal).
     *
     * @param attacker - The attacking unit to consider blocking
     * @param blocker - The blocker to consider
     */
    protected canFavorablyBlock(attacker: Unit, blocker: Unit) {
        if (!blocker.canBlockTarget(attacker, true)) {
            return false;
        }
        const type = CombatAnalyzer.categorizeBlock(attacker, blocker);
        return (
            type === BlockOutcome.AttackerDies ||
            type === BlockOutcome.NeitherDies ||
            (type === BlockOutcome.BothDie &&
                attacker.evaluate(
                    this.game,
                    EvalContext.LethalRemoval,
                    new Map()
                ) >
                    blocker.evaluate(
                        this.game,
                        EvalContext.LethalRemoval,
                        new Map()
                    ))
        );
    }

    /** Declares a blocker as blocking a particular attacker */
    protected makeBlockAction(params: { blocker: Unit; attacker: Unit }) {
        return () => {
            return this.game.declareBlocker(params.blocker, params.attacker);
        };
    }

    /**
     * Determines what units should block enemy attackers.
     *
     * If the enemy attack is potentially lethal, the A.I will focus on minimizing damage in the least disadvantageous way
     * but it will be willing to sacrifice units to block without trading (chump blocks).
     *
     * Otherwise the A.I will only make blocks considered to be favorable by the canFavorablyBlock function.
     *
     * Known Flaws
     *  - The A.I should consider chump blocking if its health is more valuable than the unit it would sacrifice.
     *  - The A.I should consider multi-blocks, but it dose not.
     *
     */
    protected block() {
        const attackers = sortBy(
            this.game.getAttackers(),
            attacker =>
                -(
                    attacker.getDamage() +
                    (attacker.hasMechanicWithId(Flying.getId()) !== undefined
                        ? 1000
                        : 0)
                )
        );
        const potentialBlockers = this.game
            .getBoard()
            .getPlayerUnits(this.playerNumber)
            .filter(unit => !unit.canBlock());

        let totalDamage = sumBy(attackers, attacker => attacker.getDamage());
        const life = this.aiPlayer.getLife();
        const blocks = [];
        for (const attacker of attackers) {
            const options = [] as {
                blocker: Unit;
                attacker: Unit;
                type: BlockOutcome;
                tradeScore: number;
            }[];
            for (const blocker of potentialBlockers) {
                if (blocker.canBlockTarget(attacker)) {
                    options.push({
                        blocker: blocker,
                        attacker: attacker,
                        type: CombatAnalyzer.categorizeBlock(attacker, blocker),
                        tradeScore:
                            blocker.evaluate(
                                this.game,
                                EvalContext.LethalRemoval,
                                new Map()
                            ) -
                            attacker.evaluate(
                                this.game,
                                EvalContext.LethalRemoval,
                                new Map()
                            )
                    });
                }
            }
            const best = minBy(
                options,
                option => option.type * 100000 + option.tradeScore
            );
            if (
                best !== undefined &&
                (totalDamage >= life ||
                    best.type < BlockOutcome.BothDie ||
                    (best.type === BlockOutcome.BothDie &&
                        best.tradeScore <= 0))
            ) {
                blocks.push(best);
                totalDamage -= best.attacker.getDamage();
                remove(potentialBlockers, unit => unit === best.blocker);
            }
        }
        const actions = blocks.map(block => {
            return this.makeBlockAction(block);
        });
        this.sequenceActions(actions);
    }
}

aiList.registerConstructor(DefaultAI);
