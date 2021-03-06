import { remove, sample, sampleSize, sum } from 'lodash';
import { Card } from './card-types/card';
import { CardFactory, cardList } from './cards/cardList';
import { Collection } from './collection';
import { GameFormat, standardFormat } from './gameFormat';
import { ResourceType, ResourceTypeNames } from './resource';

export interface SavedDeck {
    records: [string, number][];
    name: string;
    avatar: string;
    customMetadata: boolean;
    id: number;
}

export class DeckList {
    public id = -1;
    public name = 'New Deck';
    public avatar = '';
    public customMetadata = false;
    private records = new Map<string, number>();
    private cardCount = 0;

    constructor(private format: GameFormat = standardFormat, data?: SavedDeck) {
        if (data) {
            this.fromSavable(data);
        }
    }

    public randomDeckWithColors(colors: Set<string>, collection: Collection) {
        this.clear();
        const validCards = collection.getCards().filter(card => {
            return card.getCost().isInColors(colors);
        });
        for (let i = 0; i < this.format.minDeckSize; i++) {
            const card = sample(validCards);
            if (!card) {
                throw new Error('Not enough cards to form random deck');
            }
            this.addCard(card);
            if (
                this.records.get(card.getDataId()) ===
                this.format.cardsOfRarity[0]
            ) {
                remove(validCards, fact => fact === card);
            }
        }
        this.genMetadata();
    }

    public genMetadata() {
        if (this.customMetadata) {
            return;
        }
        const list = this.getRecordList();
        this.avatar = list[list.length - 1].card.getImage();
        this.name = Array.from(this.getColors().values()).join('-') + ' Deck';
    }

    public getColors() {
        const colors = new Set<ResourceType>();
        for (const record of this.getRecordList()) {
            record.card
                .getCost()
                .getColors()
                .forEach(color => colors.add(color));
        }
        return colors;
    }

    public getUniqueCards() {
        return Array.from(this.records.keys(), id => cardList.getCard(id));
    }

    public clear() {
        this.records = new Map<string, number>();
        this.cardCount = 0;
    }

    public generateRandomNColorDeck(n: number, collection: Collection) {
        n = Math.max(Math.min(n, 4), 1);
        this.randomDeckWithColors(
            new Set(sampleSize(ResourceTypeNames, n) as Array<string>),
            collection
        );
        return this;
    }

    public toJson(spacing?: number) {
        return JSON.stringify(this.getSavable(), null, spacing);
    }

    public clone() {
        const clone = new DeckList(this.format);
        clone.fromJson(this.toJson());
        return clone;
    }

    public getSavable(): SavedDeck {
        return {
            name: this.name,
            avatar: this.avatar,
            customMetadata: this.customMetadata,
            id: this.id,
            records: [...Array.from(this.records.entries())]
        };
    }

    public fromSavable(saveData: SavedDeck) {
        this.records = new Map(Array.from(saveData.records)) as Map<
            string,
            number
        >;
        this.id = saveData.id;
        this.name = saveData.name;
        this.avatar = saveData.avatar;
        this.cardCount = sum(Array.from(this.records.values()));
        this.customMetadata = saveData.customMetadata;
        for (const key of Array.from(this.records.keys())) {
            if (!cardList.exists(key)) {
                console.log(cardList.getCards().length)
                throw Error(
                    `Deck ${
                        this.name
                    } tried to load non-existent card with id ${key}.`
                );
            }
        }
    }

    public fromJson(jsonStr: string) {
        const data = JSON.parse(jsonStr) as SavedDeck;
        this.fromSavable(data);
    }

    public size() {
        return this.cardCount;
    }

    public getCardCount(card: Card) {
        return this.records.get(card.getDataId()) || 0;
    }

    public canAddCard(card: Card) {
        const currValue = this.records.get(card.getDataId()) || 0;
        const limit = this.format.maxCardsOfType;
        return currValue < limit;
    }

    public addCard(card: Card) {
        if (!this.canAddCard(card)) {
            return;
        }
        const currValue = this.records.get(card.getDataId()) || 0;
        this.records.set(card.getDataId(), currValue + 1);
        this.cardCount++;
    }

    public isValid(cardPool?: DeckList) {
        if (
            this.cardCount < this.format.minDeckSize ||
            this.cardCount > this.format.maxDeckSize
        ) {
            return false;
        }
        for (const record of this.getRecordList()) {
            const max = cardPool
                ? Math.min(
                      this.format.maxCardsOfType,
                      cardPool.getCardCount(record.card)
                  )
                : this.format.maxCardsOfType;
            if (record.number > max) {
                return false;
            }
        }

        return true;
    }

    public removeCard(card: Card) {
        if (!this.records.has(card.getDataId())) {
            return;
        }
        const currValue = this.records.get(card.getDataId()) || 0;
        if (currValue === 1) {
            this.records.delete(card.getDataId());
        } else {
            this.records.set(card.getDataId(), currValue - 1);
        }
        this.cardCount--;
    }

    public toDeck(): CardFactory[] {
        const deck: CardFactory[] = [];
        for (const entry of Array.from(this.records.entries())) {
            for (let i = 0; i < entry[1]; i++) {
                const factory = cardList.getCardFactory(entry[0]);
                if (!factory) {
                    throw new Error(`No card factory found for ${entry}`);
                }
                deck.push(factory);
            }
        }
        return deck;
    }

    public getEntries() {
        return Array.from(this.records.entries());
    }

    public getRecordList() {
        return Array.from(this.records.entries())
            .map(entry => {
                return {
                    card: cardList.getCard(entry[0]),
                    number: entry[1]
                };
            })
            .sort(
                (rec1, rec2) =>
                    rec1.card.getCost().getNumeric() -
                    rec2.card.getCost().getNumeric()
            );
    }
}
