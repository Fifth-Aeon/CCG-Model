import { ChoiceHeuristic } from '../../ai/heuristics';
import { Card } from '../../card-types/card';
import { CardType } from '../../cardType';
import { Game } from '../../game';
import { TriggeredMechanic } from '../../mechanic';
import { a } from '../../strings';
import { ParameterType } from '../parameters';

export class ReturnFromCrypt extends TriggeredMechanic {
    protected static id = 'ReturnFromCrypt';
    protected static ParameterTypes = [
        { name: 'Card Type', type: ParameterType.CardType }
    ];

    constructor(private allowed: CardType) {
        super();
    }

    public onTrigger(card: Card, game: Game) {
        const crypt = game.getCrypt(card.getOwner());
        const validCards = this.getValidCards(card, game);
        const player = game.getPlayer(card.getOwner());
        game.promptCardChoice(
            card.getOwner(),
            validCards,
            0,
            1,
            (raised: Card[]) => {
                raised.forEach(raisedCard => {
                    player.drawGeneratedCard(raisedCard);
                    crypt.splice(crypt.indexOf(raisedCard), 1);
                });
            },
            'to draw',
            ChoiceHeuristic.DrawHeuristic
        );
    }

    public getText(card: Card) {
        const cardTypeName = CardType[this.allowed];
        return `Return ${a(
            cardTypeName
        )} ${cardTypeName} from your crypt to your hand.`;
    }

    public evaluateEffect(card: Card, game: Game) {
        return this.getValidCards(card, game).length > 1 ? 3 : 0;
    }

    private getValidCards(card: Card, game: Game) {
        return game
            .getCrypt(card.getOwner())
            .filter(cryptCard => cryptCard.getCardType() === this.allowed);
    }
}
