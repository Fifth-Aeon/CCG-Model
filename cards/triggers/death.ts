import { Card } from '../../card-types/card';
import { Game } from '../../game';
import { EvalContext } from '../../mechanic';
import { removeFirstCapital } from '../../strings';
import { Trigger } from '../../trigger';
import { Unit } from '../../card-types/unit';

export class DeathTrigger extends Trigger {
    protected static id = 'Death';

    public getText(mechanicText: string) {
        return `Death: ${mechanicText}`;
    }

    public register(card: Card, game: Game) {
        const unit = card as Unit;
        unit.getEvents().death.addEvent(this, params => {
            if (!this.mechanic) {
                throw new Error(
                    'Attempting to activate an unattached trigger.'
                );
            }
            this.mechanic.setTriggeringUnit(unit);
            this.mechanic.onTrigger(card, game);
        });
    }

    public unregister(card: Card, game: Game) {
        (card as Unit).getEvents().removeEvents(this);
    }

    public evaluate(host: Card, game: Game, context: EvalContext) {
        if (context === EvalContext.LethalRemoval) {
            return 0.25;
        }
        return 0.9;
    }
}

export class SoulReap extends Trigger {
    protected static id = 'SoulReap';

    public getText(mechanicText: string) {
        return `Whenever another unit dies ${removeFirstCapital(mechanicText)}`;
    }

    public register(card: Card, game: Game) {
        game.getEvents().unitDies.addEvent(this, params => {
            if (!this.mechanic) {
                throw new Error(
                    'Attempting to activate an unattached trigger.'
                );
            }
            this.mechanic.setTriggeringUnit(params.deadUnit);
            this.mechanic.onTrigger(card, game);
        });
    }

    public unregister(card: Card, game: Game) {
        game.getEvents().removeEvents(this);
    }

    public evaluate(host: Card, game: Game, context: EvalContext) {
        return 2;
    }
}
