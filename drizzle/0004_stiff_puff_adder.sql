CREATE TABLE `screener_symbols` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`displaySymbol` varchar(30) NOT NULL,
	`assetClass` enum('FOREX','STOCK') NOT NULL,
	`enabled` int NOT NULL DEFAULT 1,
	`addedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `screener_symbols_id` PRIMARY KEY(`id`)
);
