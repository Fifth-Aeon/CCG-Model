import { Card } from './card-types/card';
import { Game } from './game';
import { Permanent } from './card-types/permanent';
import { DeckList, SavedDeck } from './deckList';
import { cardList } from './cards/cardList';
import { standardFormat } from './gameFormat';

interface ScenarioPlayer {
    initialPermanents: Permanent[];
    lifeTotal: number;
    initialHand: Card[];
    deck?: DeckList;
}

interface ScenarioPlayerData {
    initialPermanents: string[];
    lifeTotal: number;
    initialHand: string[];
    deck?: SavedDeck;
}

export interface ScenarioData {
    name: string;
    description: string;
    playerSetups: [ScenarioPlayerData, ScenarioPlayerData];
}

export class Scenario {
    private playerSetups: ScenarioPlayer[];
    private name: string;
    private description: string;
    private nextIdNumber = 1;

    constructor(data: ScenarioData) {
        this.playerSetups = data.playerSetups.map(setupData => this.unpackPlayerData(setupData));
        this.name = data.name;
        this.description = data.description;
    }

    public getName() {
        return this.name;
    }

    public getDescription() {
        return this.description;
    }

    private unpackPlayerData(data: ScenarioPlayerData): ScenarioPlayer {
        const unloadCard = (id: string) => {
            const card = cardList.getCard(id);
            card.setId('ScenarioCard' + this.nextIdNumber);
            this.nextIdNumber++;
            return card;
        };
        return {
            initialPermanents: data.initialPermanents
                .map(id => unloadCard(id))
                .filter(card => card instanceof Permanent) as Permanent[],
            lifeTotal: data.lifeTotal,
            initialHand: data.initialHand.map(id => unloadCard(id)),
            deck: new DeckList(standardFormat, data.deck)
        };
    }

    public apply(game: Game) {
        for (let playerNumber = 0; playerNumber < 2; playerNumber++) {
            const player = game.getPlayer(playerNumber);
            player.addLife(
                this.playerSetups[playerNumber].lifeTotal - player.getLife()
            );

            for (const permanent of this.playerSetups[playerNumber]
                .initialPermanents) {
                game.addCardToPool(permanent);
                player.drawGeneratedCard(permanent);
                game.playCard(player, permanent);
            }
            for (const card of this.playerSetups[playerNumber].initialHand) {
                game.addCardToPool(card);
                player.drawGeneratedCard(card);
            }
        }
    }
}
