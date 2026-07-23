-- Run this once in MySQL Workbench (inside the byqpro database) to create all tables.
CREATE DATABASE IF NOT EXISTS byqpro;
USE byqpro;

-- Simple lookup/dropdown tables (Firestore: poNos, equipments, partNames, drawingNumbers, sections, thicknesses, lengths, widths)
CREATE TABLE IF NOT EXISTS poNos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  value VARCHAR(255) NOT NULL
);
CREATE TABLE IF NOT EXISTS equipments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  value VARCHAR(255) NOT NULL
);
CREATE TABLE IF NOT EXISTS partNames (
  id INT AUTO_INCREMENT PRIMARY KEY,
  value VARCHAR(255) NOT NULL
);
CREATE TABLE IF NOT EXISTS drawingNumbers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  value VARCHAR(255) NOT NULL
);
CREATE TABLE IF NOT EXISTS sections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  value VARCHAR(255) NOT NULL
);
CREATE TABLE IF NOT EXISTS thicknesses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  value VARCHAR(255) NOT NULL
);
CREATE TABLE IF NOT EXISTS lengths (
  id INT AUTO_INCREMENT PRIMARY KEY,
  value VARCHAR(255) NOT NULL
);
CREATE TABLE IF NOT EXISTS widths (
  id INT AUTO_INCREMENT PRIMARY KEY,
  value VARCHAR(255) NOT NULL
);

-- Relation / mapping tables
CREATE TABLE IF NOT EXISTS sectionSizeRelations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sectionId VARCHAR(50),
  sizeId VARCHAR(50)
);
CREATE TABLE IF NOT EXISTS sectionSizeLengthRelations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sectionId VARCHAR(50),
  sizeId VARCHAR(50),
  lengthId VARCHAR(50)
);
CREATE TABLE IF NOT EXISTS sectionSizeWidthRelations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sectionId VARCHAR(50),
  sizeId VARCHAR(50),
  widthId VARCHAR(50)
);
CREATE TABLE IF NOT EXISTS sectionSectionalWeights (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sectionId VARCHAR(50),
  sizeId VARCHAR(50),
  sectionalWeight DOUBLE
);

-- Main entries table. "items" (the line-item array) and any other nested/extra
-- fields are stored as JSON so the shape stays flexible, same as Firestore.
CREATE TABLE IF NOT EXISTS entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  data JSON NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
