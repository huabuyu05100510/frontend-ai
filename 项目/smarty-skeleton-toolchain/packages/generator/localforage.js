import localforage from 'localforage';
localforage.config({
    driver: localforage.INDEXEDDB,
    name: 'smarty-skeleton',
});
export default localforage;
